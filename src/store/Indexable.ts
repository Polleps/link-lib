/* Taken, stripped and modified from rdflib.js */

import {
    datatypes,
    HexPos,
    Hextuple,
    JSLitDatatype,
    JSLitLang,
    JSLitValue,
    JSNamedNode,
    JSResource,
    LowLevelStore,
    Node,
    Resource,
    Term,
} from "@ontologies/core";

import { NamedNode, Quad, SomeTerm } from "../rdf";
import { SomeNode, WildHextuple } from "../types";
import { hexToQuad, objectToHexObj, quadToHex } from "../utilities/hex";
import BasicStore, { InternalHextuple } from "./BasicStore";

export type Constructable<T = object> = new (...args: any[]) => T;

export interface IndexedStore extends LowLevelStore {
    readonly quads: Hextuple[];
    readonly indices: Array<{[k: string]: Hextuple[]}>;
    canon<T extends Resource = Resource>(t: T): T;
    match(
        subj: Node | undefined | null,
        pred?: NamedNode | undefined | null,
        obj?: Term | undefined | null,
        why?: Node | undefined | null,
        justOne?: boolean,
    ): Hextuple[];
    matchHex(
        subject: JSResource,
        predicate: JSNamedNode,
        object: JSLitValue,
        datatype: JSLitDatatype | null,
        lang: JSLitLang | null,
        graph: JSResource | null,
        justOne?: boolean,
    ): Hextuple[];
}

export interface CallbackStore {
    readonly dataCallbacks: Array<(quad: Hextuple) => void>;

    removeCallback: ((quad: Hextuple) => void) | undefined;
    addDataCallback(callback: (q: Hextuple) => void): void;
}

enum SearchIndexPosition {
    // Pattern = 0,
    Hash = 0,
    Given = 1,
}
type SearchIndex = [Array<string|undefined>, number[]];

function isCallbackStore(store: any): store is CallbackStore {
    return typeof store === "object" && store !== null && "dataCallbacks" in store;
}

function updateIndices(store: IndexedStore, q: Hextuple): void {
    const indices = store.indices.length;
    const hash = [
        store.canon(q[HexPos.subject]),
        store.canon(q[HexPos.predicate]),
        store.canon(q[HexPos.object]),
        store.canon(q[HexPos.objectDT]),
        store.canon(q[HexPos.objectLang]),
        store.canon(q[HexPos.graph]),
    ];

    for (let i = 0; i < indices; i++) {
        const ix = store.indices[i];
        const h = hash[i];
        if (!ix[h]) {
            ix[h] = [];
        }
        ix[h].push(q);
    }
}

function add(
    store: IndexedStore | (IndexedStore & CallbackStore),
    subject: JSResource,
    predicate: JSNamedNode,
    objectV: JSLitValue,
    objectDt: JSLitDatatype,
    objectL: JSLitLang,
    graph: JSResource,
): Hextuple {
    const existing = store.matchHex(subject, predicate, objectV, objectDt, objectL, graph || null, true)[0];
    if (existing) {
        return existing;
    }

    const h: Hextuple = {
        0: subject,
        1: predicate,
        2: objectV,
        3: objectDt,
        4: objectL,
        5: graph,
        statementDeleted: false,
    } as unknown as Hextuple;
    updateIndices(store, h);
    store.quads.push(h);

    if (isCallbackStore(store)) {
        for (const callback of store.dataCallbacks) {
            callback(h);
        }
    }

    return h;
}

function computeSearchIndices(store: IndexedStore, pat: WildHextuple): SearchIndex {
    // Not wild
    const given = [];
    for (let i = 0; i < pat.length; i++) {
        if (pat[i] !== null) {
            given.push(i);
        }
    }

    let objHash = pat[HexPos.object] === null
        ? undefined
        : pat[HexPos.object]!;
    if (objHash !== undefined
        && (pat[HexPos.objectDT] === datatypes.namedNode
            || pat[HexPos.objectDT] === datatypes.blankNode)) {
        objHash = store.canon(objHash);
    }
    const hash = [
        pat[HexPos.subject] === null ? undefined : store.canon(pat[HexPos.subject]!),
        pat[HexPos.predicate] === null ? undefined : store.canon(pat[HexPos.predicate]!),
        objHash,
        pat[HexPos.objectDT] === null ? undefined : store.canon(pat[HexPos.objectDT]!),
        pat[HexPos.objectLang] === null ? undefined : store.canon(pat[HexPos.objectLang]!),
        pat[HexPos.graph] === null ? undefined : store.canon(pat[HexPos.graph]!),
    ];

    return [hash, given];
}

function hexByIndex(store: IndexedStore, search: SearchIndex, _: boolean): Hextuple[] {
    const p = search[SearchIndexPosition.Given][0];
    const indexEntry = (store.indices[p][search[SearchIndexPosition.Hash][p]!] as unknown as InternalHextuple[]);

    if (!indexEntry) {
        return [];
    }

    const res: Hextuple[] = [];
    for (let i = 0; i < indexEntry.length; i++) {
        if ((indexEntry[i] as any).statementDeleted === true) {
            continue;
        }
        res.push(indexEntry[i] as unknown as Hextuple);
    }

    return res;
}

function findShortestIndex(store: IndexedStore, search: SearchIndex): number|null {
    let best = 1e10; // really bad
    let bestIndex = 0;
    let list;
    const given = search[SearchIndexPosition.Given];

    for (let i = 0; i < given.length; i++) {
        const p = given[i];
        list = store.indices[p][search[SearchIndexPosition.Hash][p]!];

        if (!list) {
            return null;
        }

        if (list.length < best) {
            best = list.length;
            bestIndex = i;
        }
    }

    return bestIndex;
}

function filterIndex(
    store: IndexedStore,
    search: SearchIndex,
    bestIndex: number,
    justOne: boolean,
): Hextuple[] {
    const [hash, given] = search;

    // Ok, we have picked the shortest index but now we have to filter it
    const pBest = given[bestIndex];
    const possibles = store.indices[pBest][hash[pBest]!] as unknown as InternalHextuple[];

    // remove iBest
    const check = [];
    for (let i = 0; i < given.length; i++) {
        if (i !== bestIndex) {
            check.push(given[i]);
        }
    }

    const results = [];
    for (let j = 0; j < possibles.length; j++) {
        let st: InternalHextuple | null = possibles[j];
        if ((st as any).statementDeleted === true) {
            continue;
        }

        for (let i = 0; i < check.length; i++) { // for each position to be checked
            const p = check[i];
            const h = hash[p];
            const s = st[p];
            if (store.canon(s as string) !== h && s !== h) {
                st = null;
                break;
            }
        }
        if (st !== null) {
            results.push(st);
            if (justOne) { break; }
        }
    }

    return results as unknown as Hextuple[];
}

export function match(store: IndexedStore, search: WildHextuple, justOne: boolean): Hextuple[] {
    const parsedSearch = computeSearchIndices(store, search);

    if (parsedSearch[SearchIndexPosition.Given].length === 0) {
        return (store.quads as unknown as InternalHextuple[])
            .filter(([, , , , , , del]) => !del) as unknown as Hextuple[];
    }
    if (parsedSearch[SearchIndexPosition.Given].length === 1) { // Easy too, we have an index for that
        return hexByIndex(store, parsedSearch, justOne);
    }

    const bestStartIndex = findShortestIndex(store, parsedSearch);
    if (bestStartIndex === null) {
        return [];
    }

    return filterIndex(store, parsedSearch, bestStartIndex, justOne);
}

// tslint:disable-next-line:typedef
export function Indexable<BC extends Constructable<BasicStore>>(base: BC) {
    return class extends base implements IndexedStore {
        public indices: Array<{ [k: string]: Hextuple[] }>;

        public subjectIndex: { [k: string]: Hextuple[] } = {};
        public predicateIndex: { [k: string]: Hextuple[] } = {};
        public objectIndex: { [k: string]: Hextuple[] } = {};
        public datatypeIndex: { [k: string]: Hextuple[] } = {};
        public langIndex: { [k: string]: Hextuple[] } = {};
        public graphIndex: { [k: string]: Hextuple[] } = {};

        constructor(...args: any[]) {
            super(...args);

            this.indices = [
                this.subjectIndex,
                this.predicateIndex,
                this.objectIndex,
                this.datatypeIndex,
                this.langIndex,
                this.graphIndex,
            ];
        }

        /**
         * Adds a triple (quad) to the store.
         *
         * @param {Term} subject - The thing about which the fact a relationship is asserted
         * @param {namedNode} predicate - The relationship which is asserted
         * @param {Term} object - The object of the relationship, e.g. another thing or avalue
         * @param {namedNode} graph - The document in which the triple (S,P,O) was or will be stored on the web
         * @returns {Quad} The quad added to the store
         */
        public add(
            subject: SomeNode,
            predicate: NamedNode,
            object: SomeTerm,
            graph: SomeNode = this.rdfFactory.defaultGraph(),
        ): Quad {
            const [v, dt, l] = objectToHexObj(object);
            return hexToQuad(add(this, subject, predicate, v, dt, l, graph));
        }

        public addH(
            subject: JSResource,
            predicate: JSNamedNode,
            object: JSLitValue,
            dt: JSLitDatatype,
            lang: JSLitLang,
            graph: JSResource = this.rdfFactory.defaultGraph(),
        ): Hextuple {
            return add(this, subject, predicate, object, dt, lang, graph);
        }

        public canon<T extends Resource = Resource>(term: T): T {
            return term;
        }

        /**
         * Remove a particular quad object from the store
         *
         * st    a quad which is already in the store and indexed.
         *      Make sure you only use this for these.
         *    Otherwise, you should use remove() above.
         */
        public removeQuad(quad: Quad): this {
            const term = [
                quad.subject,
                quad.predicate,
                ...objectToHexObj(quad.object),
                quad.graph,
            ];
            const hex = quadToHex(quad);
            const len = this.indices.length;
            for (let p = 0; p < len; p++) {
                const h = this.canon(term[p]);
                if (this.indices[p][h]) {
                    this.rdfArrayRemove(this.indices[p][h], hex);
                }
            }
            if (this.removeCallback) {
                this.removeCallback(hex);
            }
            this.rdfArrayRemove(this.quads, hex);
            return this;
        }

        public removeHex(hex: Hextuple): this {
            if (!this.cleanTimeout
                && typeof window !== "undefined"
                && typeof window.requestIdleCallback === "function") {
                this.cleanTimeout = window.requestIdleCallback(this.cleanIndices, { timeout: 10000 });
            }

            (hex as any).statementDeleted = true;
            // (hex as unknown as InternalHextuple)[HexPos.graph + 1] = true;
            if (this.removeCallback) {
                this.removeCallback(hex);
            }
            return this;
        }

        /**
         * Search the Store
         *
         * ALL CONVENIENCE LOOKUP FUNCTIONS RELY ON THIS!
         * @param {Node} subject - A node to search for as subject, or if null, a wildcard
         * @param {Node} predicate - A node to search for as predicate, or if null, a wildcard
         * @param {Node} object - A node to search for as object, or if null, a wildcard
         * @param {Node} graph - A node to search for as graph, or if null, a wildcard
         * @param {Boolean} justOne - flag - stop when found one rather than get all of them?
         * @returns {Array<Node>} - An array of nodes which match the wildcard position
         */
        public match(
            subject: SomeNode | null,
            predicate: NamedNode | null,
            object: SomeTerm | null,
            graph: SomeNode | null,
            justOne: boolean = false,
        ): Hextuple[] {
            return match(
                this,
                [subject, predicate, ...objectToHexObj(object!), graph] as WildHextuple,
                justOne,
            );
        }

        public matchHex(
            subject: string | null,
            predicate: string | null,
            object: string | null,
            datatype: string | null,
            lang: string | null,
            graph: string | null,
            justOne: boolean = false,
        ): Hextuple[] {
            return match(this, [subject, predicate, object, datatype, lang, graph], justOne);
        }

        /** @ignore */
        public cleanIndices(): void {
            const next = [];
            const subjectIndex: { [k: string]: Hextuple[] } = {};
            const predicateIndex: { [k: string]: Hextuple[] } = {};
            const objectIndex: { [k: string]: Hextuple[] } = {};
            const datatypeIndex: { [k: string]: Hextuple[] } = {};
            const langIndex: { [k: string]: Hextuple[] } = {};
            const graphIndex: { [k: string]: Hextuple[] } = {};
            let q;
            const quads = this.quads;
            const length = this.quads.length;
            for (let i = 0; i < length; i++) {
                q = quads[i];
                if ((q as any).statementDeleted !== true) {
                    next.push(q);

                    const sCanon = this.canon(q[HexPos.subject]);
                    if (subjectIndex[sCanon]) {
                        subjectIndex[sCanon].push(q);
                    } else {
                        subjectIndex[sCanon] = [q];
                    }

                    const pCanon = this.canon(q[HexPos.predicate]);
                    if (predicateIndex[pCanon]) {
                        predicateIndex[pCanon].push(q);
                    } else {
                        predicateIndex[pCanon] = [q];
                    }

                    const oCanon = this.canon(q[HexPos.object]);
                    if (objectIndex[oCanon]) {
                        objectIndex[oCanon].push(q);
                    } else {
                        objectIndex[oCanon] = [q];
                    }

                    const dtCanon = this.canon(q[HexPos.objectDT]);
                    if (datatypeIndex[dtCanon]) {
                        datatypeIndex[dtCanon].push(q);
                    } else {
                        datatypeIndex[dtCanon] = [q];
                    }

                    const lCanon = this.canon(q[HexPos.objectLang]);
                    if (langIndex[lCanon]) {
                        langIndex[lCanon].push(q);
                    } else {
                        langIndex[lCanon] = [q];
                    }

                    const gCanon = this.canon(q[HexPos.graph]);
                    if (graphIndex[gCanon]) {
                        graphIndex[gCanon].push(q);
                    } else {
                        graphIndex[gCanon] = [q];
                    }
                }
            }
            this.quads = next;
            this.subjectIndex = subjectIndex;
            this.predicateIndex = predicateIndex;
            this.objectIndex = objectIndex;
            this.datatypeIndex = datatypeIndex;
            this.langIndex = langIndex;
            this.graphIndex = graphIndex;
            this.indices = [
                this.subjectIndex,
                this.predicateIndex,
                this.objectIndex,
                this.datatypeIndex,
                this.langIndex,
                this.graphIndex,
            ];

            this.cleanTimeout = undefined;
        }
    };
}
