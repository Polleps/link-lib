import rdfFactory, {
    isQuad,
    NamedNode,
    Node,
    Quad,
    QuadPosition,
    Quadruple,
    SomeTerm,
    Term,
    TermType,
} from "@ontologies/core";
import * as rdf from "@ontologies/rdf";
import * as schema from "@ontologies/schema";

import { ComponentStore } from "./ComponentStore";
import { equals, id } from "./factoryHelpers";
import { APIFetchOpts, LinkedDataAPI } from "./LinkedDataAPI";
import { ProcessBroadcast } from "./ProcessBroadcast";
import { DataProcessor, emptyRequest } from "./processor/DataProcessor";
import { dataToGraphTuple } from "./processor/DataToGraph";
import { isPending } from "./processor/requestStatus";
import { RDFStore } from "./RDFStore";
import { Schema } from "./Schema";
import {
    ActionMap,
    ComponentRegistration,
    DataObject,
    DeltaProcessor,
    Dispatcher,
    EmptyRequestStatus,
    ErrorReporter,
    FetchOpts,
    Indexable,
    LazyNNArgument,
    LinkedActionResponse,
    LinkedRenderStoreOptions,
    MiddlewareActionHandler,
    NamespaceMap,
    ResourceQueueItem,
    SomeNode,
    SomeRequestStatus,
    SubscriptionRegistrationBase,
} from "./types";
import { normalizeType } from "./utilities";
import { DEFAULT_TOPOLOGY, RENDER_CLASS_NAME } from "./utilities/constants";

const normalizedIds = <T>(item: T, defaultValue: Node | undefined = undefined): number[] => normalizeType(item)
    .map((t) => id(t || defaultValue));

/**
 * Main entrypoint into the functionality of link-lib.
 *
 * Before using the methods for querying data and views here, search through your render library (e.g. link-redux) to
 * see if it exposes an API which covers your use-case. Skipping the render library might cause unexpected behaviour and
 * hard to solve bugs.
 */
export class LinkedRenderStore<T, API extends LinkedDataAPI = DataProcessor> implements Dispatcher {
    public static registerRenderer<T>(
        component: T,
        type: LazyNNArgument,
        prop: LazyNNArgument = RENDER_CLASS_NAME,
        topology: LazyNNArgument | Array<NamedNode | undefined> = DEFAULT_TOPOLOGY): Array<ComponentRegistration<T>> {

        const types = normalizedIds(type);
        const props = normalizedIds(prop, RENDER_CLASS_NAME);
        const topologies = normalizedIds(topology, DEFAULT_TOPOLOGY);

        return ComponentStore.registerRenderer(component, types, props, topologies);
    }

    /**
     * Map of {ActionMap} which hold action dispatchers. Calling a dispatcher should execute the action, causing them to
     * be handled like any back-end sent action.
     *
     * Constructing action IRI's and dispatching them in user code was a bit hard, this object allows any middleware to
     * define their actions (within their namespace) in a code-oriented fashion. The middleware has control over how the
     * actions will be dispatched, but it should be the same as if a back-end would have executed the action (via the
     * Exec-Action header).
     */
    public actions: { [k: string]: ActionMap } = {};
    /** Whenever a resource has no type, assume it to be this. */
    public defaultType: NamedNode = schema.Thing;
    public deltaProcessors: DeltaProcessor[];
    public report: ErrorReporter;
    /**
     * Can aid in parsing an creating prefix mapping strings.
     * @deprecated Please use @ontologies/<namespace> packages in your programs, canonicalizing certain
     *   prefixes will lead to brittle and hard to refactor code!
     */
    public namespaces: NamespaceMap = {};

    public api: API;
    public mapping: ComponentStore<T>;
    public schema: Schema<Indexable>;
    public store: RDFStore = new RDFStore();
    /**
     * Enable the bulk api to fetch data with.
     */
    public bulkFetch: boolean = false;

    private _dispatch?: MiddlewareActionHandler;
    private cleanupTimout: number = 500;
    private cleanupTimer: number | undefined;
    private currentBroadcast: Promise<void> | undefined;
    private broadcastHandle: number | undefined;
    private bulkSubscriptions: Array<SubscriptionRegistrationBase<unknown>> = [];
    private subjectSubscriptions: { [k: string]: Array<SubscriptionRegistrationBase<unknown>> } = {};
    private lastPostponed: number | undefined;
    private resourceQueueFlushTimer: number = 100;
    private resourceQueue: ResourceQueueItem[];
    private resourceQueueHandle: number | undefined;

    // tslint:disable-next-line no-object-literal-type-assertion
    public constructor(opts: LinkedRenderStoreOptions<T, API> = {}) {
        if (opts.store) {
            this.store = opts.store;
        }

        this.report = opts.report || ((e): void => { throw e; });
        this.api = opts.api || new DataProcessor({
            ...opts.apiOpts,
            dispatch: opts.dispatch,
            report: this.report,
            store: this.store,
        }) as unknown as API;
        this.deltaProcessors = [this.api, this.store];
        if (opts.dispatch) {
            this.dispatch = opts.dispatch;
        }
        this.defaultType = opts.defaultType || schema.Thing;
        this.namespaces = opts.namespaces || {};
        this.schema = opts.schema || new Schema(this.store);
        this.mapping = opts.mapping || new ComponentStore(this.schema);
        this.resourceQueue = [];

        this.broadcast = this.broadcast.bind(this);
        this.processResourceQueue = this.processResourceQueue.bind(this);
    }

    public get dispatch(): MiddlewareActionHandler {
        if (typeof this._dispatch === "undefined") {
            throw new Error("Invariant: cannot call `dispatch` before initialization is complete, see createStore");
        }

        return this._dispatch;
    }

    public set dispatch(value: MiddlewareActionHandler) {
        this._dispatch = value;
        this.api.dispatch = value;
    }

    /**
     * Add a custom delta processor in the stack.
     */
    public addDeltaProcessor(processor: DeltaProcessor): void {
        this.deltaProcessors.unshift(processor);
    }

    /**
     * Push one or more ontological items onto the graph so it can be used by the render store for component
     * determination.
     *
     * Adding information after the initial render currently conflicts with the caching and will result in inconsistent
     * results.
     *
     * Statements added here will also be added to the data store so views can access the statements.
     */
    public addOntologySchematics(items: Quad[]): void {
        this.schema.addQuads(items);
    }

    /**
     * Execute an Action by its IRI. This will result in an HTTP request being done and probably some state changes.
     * @param {NamedNode} subject The resource to execute. Generally a schema:Action derivative with a
     *   schema:EntryPoint to describe the request. Currently schema:url is used over schema:urlTemplate
     *   to acquire the request URL, since template processing isn't implemented (yet).
     * @param {DataObject} data An object to send in the body when a non-safe method is used.
     * @return {Promise<LinkedActionResponse>}
     */
    public execActionByIRI(subject: NamedNode, data?: DataObject): Promise<LinkedActionResponse> {
        const preparedData = dataToGraphTuple(data || {}, this.namespaces);
        return this
            .api
            .execActionByIRI(subject, preparedData)
            .then((res: LinkedActionResponse) => {
                this.broadcast(false, 100);
                return res;
            });
    }

    /**
     * Execute a resource.
     *
     * Every action will fall through the execution middleware layers.
     *
     * @see https://github.com/rescribet/link-lib/wiki/%5BDesign-draft%5D-Actions,-data-streams,-and-middleware
     *
     * @param {NamedNode} subject The resource to execute (can be either an IRI or an URI)
     * @param {Object} args The arguments to the function defined by the subject.
     */
    public async exec(subject: NamedNode, args?: DataObject): Promise<any> {
        return this.dispatch(subject, args);
    }

    /**
     * Resolve the values at the end of the path
     * @param subject The resource to start descending on
     * @param path A list of linked predicates to descend on.
     */
    public dig(subject: Node | undefined, path: NamedNode[]): SomeTerm[] {
        const [result] = this.digDeeper(subject, path);

        return result;
    }

    /**
     * @internal See {dig}
     * @param subject
     * @param path
     * @param subjects - The subjects traversed.
     */
    public digDeeper(subject: Node | undefined, path: NamedNode[]): [SomeTerm[], SomeNode[]] {
        if (path.length === 0 || typeof subject === "undefined") {
            return [[], []];
        }

        const remaining = path.slice();
        const pred = remaining.shift();

        if (remaining.length === 0) {
            return [this.getResourceProperties(subject, pred!), [subject]];
        }

        const props = this.getResourceProperties(subject, pred!);
        if (props) {
            const allTerms = [];
            const allSubjects = [subject];

            for (const term of props) {
              if (term.termType === TermType.NamedNode || term.termType === TermType.BlankNode) {
                const [terms, subs] = this.digDeeper(term, remaining);
                allSubjects.push(...subs);
                if (terms.length > 0) {
                    allTerms.push(...terms);
                }
              }
            }

            return [allTerms, allSubjects];
        }

        return [[], [subject]];
    }

    /**
     * Retrieve the subjects from {subject} to find all resources which have an object at the
     * end of the {path} which matches {match}.
     * @param subject The resource to start descending on.
     * @param path A list of linked predicates to descend on.
     * @param match The value which the predicate at the end of {path} has to match for its subject to return.
     */
    public findSubject(subject: Node | undefined, path: NamedNode[], match: Term | Term[]): Node[] {
        if (path.length === 0 || typeof subject === "undefined") {
            return [];
        }

        const remaining = path.slice();
        const pred = remaining.shift();
        const props = this.getResourceProperties(subject, pred!);

        if (props.length === 0) {
            return [];
        }

        if (remaining.length === 0) {
            const finder = Array.isArray(match)
                ? (p: Term): boolean => match.some((m) => equals(m, p))
                : (p: Term): boolean => equals(match, p);

            return props.find(finder) ? [subject] : [];
        }

        return props
            .map((term) => (term.termType === TermType.NamedNode || term.termType === TermType.BlankNode)
                && this.findSubject(term as Node, remaining, match))
            .flat(1)
            .filter<Node>(Boolean as any);
    }

    /**
     * Finds the best render component for a given property in respect to a topology.
     *
     * @renderlibrary This should only be used by render-libraries, not by application code.
     * @param type The type(s) of the resource to render.
     * @param predicate The predicate(s) (property(s)) to render.
     * @param [topology] The topology of the resource, if any
     * @returns The most appropriate renderer, if any.
     */
    public getComponentForProperty(type: NamedNode | NamedNode[] | undefined = this.defaultType,
                                   predicate: NamedNode | NamedNode[],
                                   topology: NamedNode = DEFAULT_TOPOLOGY): T | undefined {
        if (type === undefined || (Array.isArray(type) && type.length === 0)) {
            return undefined;
        }
        const types = normalizeType(type).map(id);
        const predicates = normalizeType(predicate).map(id);

        return this.mapping.getRenderComponent(
            types,
            predicates,
            id(topology),
            id(this.defaultType),
        );
    }

    /**
     * Finds the best render component for a type in respect to a topology.
     *
     * @renderlibrary This should only be used by render-libraries, not by application code.
     * @see LinkedRenderStore#getComponentForProperty
     * @param type The type(s) of the resource to render.
     * @param [topology] The topology of the resource, if any
     * @returns The most appropriate renderer, if any.
     */
    public getComponentForType(type: NamedNode | NamedNode[], topology: NamedNode = DEFAULT_TOPOLOGY): T | undefined {
        return this.getComponentForProperty(type, RENDER_CLASS_NAME, topology);
    }

    /**
     * Efficiently queues a resource to be fetched later.
     *
     * This skips the overhead of creating a promise and allows the subsystem to retrieve multiple resource in one
     * round trip, sacrificing loading status for performance.
     * @renderlibrary This should only be used by render-libraries, not by application code.
     */
    public queueEntity(iri: NamedNode, opts?: FetchOpts): void {
        if (!(opts && opts.reload) && !this.shouldLoadResource(iri)) {
            return;
        }

        this.resourceQueue.push([iri, opts]);
        this.scheduleResourceQueue();
    }

    /**
     * Queue a linked-delta to be processed.
     *
     * Note: This should only be used by render-libraries (e.g. link-redux), not by application code.
     * @renderlibrary This should only be used by render-libraries, not by application code.
     */
    public queueDelta(delta: Array<Quadruple|void> | Quad[], expedite = false): Promise<void> {
        const quadArr = isQuad(delta[0])
            ? (delta as Quad[]).map((s: Quad) => rdfFactory.qdrFromQuad(s))
            : delta as Quadruple[];
        const subjects: number[] = [];
        let sId;
        for (let i = 0; i < quadArr.length; i++) {
            if (!quadArr[i]) {
                continue;
            }
            sId = id(quadArr[i][QuadPosition.subject]);
            if (!subjects.includes(sId)) {
                subjects.push(sId);
            }
        }

        for (const dp of this.deltaProcessors) {
            dp.queueDelta(quadArr, subjects);
        }

        return this.broadcastWithExpedite(expedite);
    }

    /**
     * Will fetch the entity with the URL {iri}. When a resource under that subject is already present, it will not
     * be fetched again.
     *
     * @deprecated Use {queueEntity} instead
     * @param iri The Node of the resource
     * @param opts The options for fetch-/processing the resource.
     * @return A promise with the resulting entity
     */
    public async getEntity(iri: NamedNode, opts?: FetchOpts): Promise<void> {
        const apiOpts: APIFetchOpts = {};
        let preExistingData;
        if (opts && opts.reload) {
            apiOpts.clearPreviousData = true;
            preExistingData = this.tryEntity(iri);
        }
        if (preExistingData !== undefined) {
            this.store.removeQuads(preExistingData);
        }
        await this.api.getEntity(iri, apiOpts);
        return this.broadcast();
    }

    /**
     * Resolves all the properties {property} of resource {subject} to their statements.
     *
     * @renderlibrary This should only be used by render-libraries, not by application code.
     * @param {Node} subject The resource to get the properties for.
     * @param {Node | Node[]} property
     * @return {Statement[]} All the statements of {property} on {subject}, or an empty array when none are present.
     */
    public getResourcePropertyRaw(subject: Node | undefined, property: Node | Node[] | undefined): Quad[] {
        if (typeof subject === "undefined" || typeof property === "undefined") {
            return [];
        }

        return this.store.getResourcePropertyRaw(subject, property);
    }

    /**
     * Resolves all the properties {property} of resource {subject} to a value.
     *
     * @renderlibrary This should only be used by render-libraries, not by application code.
     * @typeParam TT The expected return type for the properties.
     * @param {Node} subject The resource to get the properties for.
     * @param {Node | Node[]} property
     * @return {Term[]} The resolved values of {property}, or an empty array when none are present.
     */
    public getResourceProperties<TT extends Term = SomeTerm>(
      subject: Node | undefined,
      property: Node | Node[] | undefined,
    ): TT[] {
        if (typeof subject === "undefined" || typeof property === "undefined") {
           return [];
        }

        return this.store.getResourceProperties<TT>(subject, property);
    }

    /**
     * Resolves the property {property} of resource {subject} to a value.
     *
     * When more than one statement on {property} is present, a random one will be chosen. See
     * {LinkedResourceContainer#getResourceProperties} to retrieve all the values.
     *
     * @renderlibrary This should only be used by render-libraries, not by application code.
     * @typeParam TT The expected return type for the property.
     * @param {Node} subject The resource to get the properties for.
     * @param {Node | Node[]} property
     * @return {Term | undefined} The resolved value of {property}, or undefined when none are present.
     */
    public getResourceProperty<TT extends Term = SomeTerm>(
      subject: Node | undefined,
      property: Node | Node[] | undefined,
    ): TT | undefined {
        if (typeof subject === "undefined" || typeof property === "undefined") {
            return undefined;
        }

        return this.store.getResourceProperty<TT>(subject, property);
    }

    /**
     * Retrieve the (network) status of the resource {iri}.
     *
     * Status 202 indicates that the resource has been queued for fetching (subject to change).
     */
    public getStatus(iri: Node): SomeRequestStatus {
        if (iri.termType === TermType.BlankNode) {
            return emptyRequest as EmptyRequestStatus;
        }

        if (this.resourceQueue.find(([resource]) => equals(resource, iri))) {
            return {
                lastRequested: new Date(),
                lastResponseHeaders: null,
                requested: true,
                status: 202,
                subject: iri,
                timesRequested: 1,
            };
        }

        return this.api.getStatus(iri);
    }

    /**
     * Process a linked-delta onto the store.
     *
     * This should generally only be called from the middleware or the data api
     * @param delta An array of [s, p, o, g] arrays containing the delta.
     * @param expedite Will immediately process the delta rather than waiting for an idle moment, useful in conjunction
     *  with event handlers within the UI needing immediate feedback. Might cause jumpy interfaces.
     */
    public processDelta(delta: Array<Quadruple|void> | Quad[], expedite = false): Promise<Quad[]> {
        const quadArr = Object.prototype.hasOwnProperty.call(delta[0], "subject")
            ? (delta as Quad[]).map((s: Quad) => rdfFactory.qdrFromQuad(s))
            : delta as Quadruple[];
        const processors = this.deltaProcessors;
        const statements: Quad[] = [];
        for (let i = 0; i < processors.length; i++) {
            statements.push(...processors[i].processDelta(quadArr));
        }

        return this.broadcastWithExpedite(expedite)
            .then(() => statements);
    }

    /**
     * Bulk register components formatted with {LinkedRenderStore.registerRenderer}.
     * @see LinkedRenderStore.registerRenderer
     */
    public registerAll(...components: Array<ComponentRegistration<T> | Array<ComponentRegistration<T>>>): void {
        const registerItem = (i: ComponentRegistration<T>): void => {
            this.mapping.registerRenderer(
                i.component,
                i.type,
                i.property,
                i.topology,
            );
        };

        for (let i = 0; i < components.length; i++) {
            const innerRegs = normalizeType(components[i]);

            for (let j = 0; j < innerRegs.length; j++) {
                registerItem(innerRegs[j]);
            }
        }
    }

    /**
     * Remove a resource from the store, when views are still rendered the resource will be re-fetched.
     *
     * @unstable
     */
    public removeResource(subject: Node, expedite = false): Promise<void> {
        this.api.invalidate(subject);
        this.store.removeResource(subject);

        return this.broadcastWithExpedite(expedite);
    }

    /**
     * Resets the render store mappings and the schema graph.
     *
     * Note: This should only be used by render-libraries (e.g. link-redux), not by application code.
     */
    public reset(): void {
        this.store = new RDFStore();
        this.schema = new Schema(this.store);
        this.mapping = new ComponentStore(this.schema);
    }

    /**
     * Get a render component for a rendering {property} on resource {subject}.
     *
     * @renderlibrary
     * @param {Node} subject
     * @param {NamedNode | NamedNode[]} predicate
     * @param {NamedNode} topology
     * @return {T | undefined}
     */
    public resourcePropertyComponent(subject: Node,
                                     predicate: NamedNode | NamedNode[],
                                     topology?: NamedNode): T | undefined {
        return this.getComponentForProperty(
            this.store.getResourceProperties(subject, rdf.type) as NamedNode[],
            predicate,
            topology || DEFAULT_TOPOLOGY,
        );
    }

    /**
     * Get a render component for {subject}.
     *
     * @renderlibrary
     * @param {Node} subject The resource to get the renderer for.
     * @param {NamedNode} topology The topology to take into account when picking the renderer.
     * @return {T | undefined}
     */
    public resourceComponent(subject: Node, topology?: NamedNode): T | undefined {
        return this.getComponentForProperty(
            this.store.getResourceProperties(subject, rdf.type) as NamedNode[],
            RENDER_CLASS_NAME,
            topology || DEFAULT_TOPOLOGY,
        );
    }

    /**
     * Determine if it makes sense to load a resource.
     *
     * @renderlibrary
     * @unstable
     */
    public shouldLoadResource(subject: Node): boolean {
        return (this.store.changeTimestamps[id(subject)] === undefined || this.api.isInvalid(subject))
            && !this.resourceQueue.find(([i]) => equals(i, subject))
            && !isPending(this.api.getStatus(subject));
    }

    /**
     * Listen for data changes by subscribing to store changes.
     *
     * @renderlibrary This should only be used by render-libraries, not by application code.
     * @param registration
     * @param registration[0] Will be called with the new statements as its argument.
     * @param registration[1] Options for the callback.
     * @param registration[1].onlySubjects Only the subjects are passed when true.
     * @return function Unsubscription function.
     */
    public subscribe(registration: SubscriptionRegistrationBase<unknown>): () => void {
        registration.subscribedAt = Date.now();
        const subjectFilter = registration.subjectFilter;

        if (typeof subjectFilter !== "undefined" && subjectFilter.length > 0) {
            for (let i = 0, len = subjectFilter.length; i < len; i++) {
                const sId = id(subjectFilter[i]);
                if (!this.subjectSubscriptions[sId]) {
                    this.subjectSubscriptions[sId] = [];
                }
                this.subjectSubscriptions[sId].push(registration);
            }

            return (): void => {
                registration.markedForDelete = true;
                this.markForCleanup();
            };
        }

        this.bulkSubscriptions.push(registration);

        return (): void => {
            registration.markedForDelete = true;
            this.bulkSubscriptions.splice(this.bulkSubscriptions.indexOf(registration), 1);
        };
    }

    /** @internal */
    public touch(_iri: string | NamedNode, _err?: Error): boolean {
        this.broadcast();
        return true;
    }

    /**
     * Returns an entity from the cache directly.
     * This won't cause any network requests even if the entity can't be found.
     *
     * @renderlibrary This should only be used by render-libraries, not by application code.
     * @param iri The Node of the resource.
     * @returns The object if found, or undefined.
     */
    public tryEntity(iri: Node): Quad[] {
        return this.store.quadsFor(iri);
    }

    /**
     * Broadcasts buffered to all subscribers.
     * The actual broadcast might be executed asynchronously to prevent lag.
     *
     * @param buffer Controls whether processing can be delayed until enough is available.
     * @param maxTimeout Set to 0 to execute immediately.
     * Note: This should only be used by render-libraries (e.g. link-redux), not by application code.
     */
    private broadcast(buffer = true, maxTimeout = 1000): Promise<void> {
        if (maxTimeout !== 0 && this.currentBroadcast || this.broadcastHandle) {
            return this.currentBroadcast || Promise.resolve();
        }

        if (buffer) {
            if (this.store.workAvailable() >= 2) {
                if (this.broadcastHandle) {
                    window.clearTimeout(this.broadcastHandle);
                }
                if ((this.lastPostponed === undefined) || Date.now() - this.lastPostponed <= maxTimeout) {
                    if (this.lastPostponed === undefined) {
                        this.lastPostponed = Date.now();
                    }
                    this.broadcastHandle = window.setTimeout(() => {
                        this.broadcastHandle = undefined;
                        this.broadcast(buffer, maxTimeout);
                    }, 200);

                    return this.currentBroadcast || Promise.resolve();
                }
            }
            this.lastPostponed = undefined;
            this.broadcastHandle = undefined;
        }
        if (this.store.workAvailable() === 0) {
            return Promise.resolve();
        }

        const work = this.deltaProcessors.flatMap((dp) => dp.flush());
        const uniqueSubjects = new Set<number>();
        const wLen = work.length;
        let w;
        for (let i = 0; i < wLen; i++) {
            w = work[i];
            uniqueSubjects.add(id(w.subject));
            uniqueSubjects.add(id(w.graph));
            uniqueSubjects.add(id(this.store.canon(w.subject)));
            uniqueSubjects.add(id(this.store.canon(w.graph)));
        }
        const subjects = Array.from(uniqueSubjects);
        const subjectRegs = subjects
            .flatMap((sId) => this.subjectSubscriptions[sId])
            .filter((reg) => reg
                && !reg.markedForDelete
                && (reg.subjectFilter
                    ? reg.subjectFilter.some((s) => subjects.includes(id(s)))
                    : true));

        if (this.bulkSubscriptions.length === 0 && subjectRegs.length === 0) {
            return Promise.resolve();
        }

        return this.currentBroadcast = new ProcessBroadcast({
            bulkSubscriptions: this.bulkSubscriptions.slice(),
            changedSubjects: subjects,
            subjectSubscriptions: subjectRegs,
            timeout: maxTimeout,
            work,
        }).run()
          .then(() => {
              this.currentBroadcast = undefined;
              if (this.store.workAvailable() > 0) {
                  this.broadcast();
              }
          });
    }

    private broadcastWithExpedite(expedite: boolean): Promise<void> {
        return this.broadcast(!expedite, expedite ? 0 : 500);
    }

    private markForCleanup(): void {
        if (this.cleanupTimer) {
            return;
        }

        this.cleanupTimer = window.setTimeout(() => {
            this.cleanupTimer = undefined;
            for (const [ k, value ] of Object.entries(this.subjectSubscriptions)) {
                this.subjectSubscriptions[k] = value.filter((p) => !p.markedForDelete);
            }
        }, this.cleanupTimout);
    }

    private scheduleResourceQueue(): void {
        if (this.resourceQueueHandle) {
            return;
        }

        if (typeof window === "undefined") {
            setTimeout(this.processResourceQueue, this.resourceQueueFlushTimer);
        } else if (typeof window.requestIdleCallback !== "undefined") {
            this.resourceQueueHandle = window.requestIdleCallback(
              this.processResourceQueue,
              { timeout: this.resourceQueueFlushTimer },
            );
        } else {
            this.resourceQueueHandle = window.setTimeout(
              this.processResourceQueue,
              this.resourceQueueFlushTimer,
            );
        }
    }

    private async processResourceQueue(): Promise<void> {
        this.resourceQueueHandle = undefined;
        const queue = this.resourceQueue;
        this.resourceQueue = [];

        if (this.bulkFetch) {
            await this.api.getEntities(queue);
            return this.broadcast();
        } else {
            for (let i = 0; i < queue.length; i++) {
                try {
                    const [iri, opts] = queue[i];
                    await this.getEntity(iri, opts);
                } catch (e) {
                    this.report(e);
                }
            }
        }
    }
}
