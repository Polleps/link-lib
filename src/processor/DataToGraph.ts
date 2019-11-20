import rdfFactory, { Literal, NamedNode, Node, TermType } from "@ontologies/core";
import rdf from "@ontologies/rdf";
import { graph as getGraph, Store } from "../rdflib";

import {
    DataObject,
    DataTuple,
    NamedBlobTuple,
    ParsedObject,
    SerializableDataTypes,
    SomeNode,
} from "../types";
import { defaultNS, MAIN_NODE_DEFAULT_IRI, NON_DATA_OBJECTS_CTORS } from "../utilities/constants";
import { expandProperty } from "../utilities/memoizedNamespace";

const BASE = 36;
const DEC_CUTOFF = 2;
const IRI_LEN = 20;

function isPlainObject(o: any): o is DataObject {
    return typeof o === "object"
        && o !== null
        && !NON_DATA_OBJECTS_CTORS.find((c) => typeof o.prototype !== "undefined" && o instanceof c)
        && !Object.prototype.hasOwnProperty.call(o, "termType");
}

function isIterable(o: any): o is any[] | Set<any> {
    return Array.isArray(o) || o instanceof Set;
}

function uploadIRI(): NamedNode {
    return defaultNS.ll(`blobs/a${Math.random().toString(BASE).substr(DEC_CUTOFF, IRI_LEN)}`);
}

/**
 * Converts an array to an RDF list-shaped {DataObject} for serialization.
 */
export function list(arr: SerializableDataTypes[]): DataObject {
    // @ts-ignore
    return arr.reduceRight((acc: DataObject, next: SerializableDataTypes) => ({
        [rdf.first.toString()]: next,
        [rdf.rest.toString()]: acc,
    }), rdf.nil);
}

/**
 * Converts an array to an RDF sequence-shaped {DataObject} for serialization.
 */
export function seq<T = any>(arr: T[], id?: SomeNode): DataObject {
    const base: DataObject = { [rdf.type.toString()]: rdf.Seq };
    if (id) {
        base["@id"] = id;
    }

    return arr.reduce(
        (acc, next, n) => Object.assign(acc, { [rdf.ns(`_${n}`).toString()]: next }),
        base,
    );
}

/** @private */
export function processObject(subject: Node,
                              predicate: NamedNode,
                              datum: DataObject | SerializableDataTypes | null | undefined,
                              graph: Store): NamedBlobTuple[] {
    let blobs: NamedBlobTuple[] = [];

    if (isIterable(datum)) {
        for (const subResource of datum) {
            if (isPlainObject(subResource)) {
                const id = (subResource as DataObject)["@id"] as SomeNode | undefined || rdfFactory.blankNode();
                blobs = blobs.concat(processDataObject(id, subResource as DataObject, graph));
                graph.add(subject, predicate, id);
            } else {
                blobs = blobs.concat(processObject(subject, predicate, subResource, graph));
            }
        }
    } else if (typeof datum === "string"
        || typeof datum === "number"
        || typeof datum === "boolean"
        || datum instanceof Date) {
        graph.add(subject, predicate, rdfFactory.literal(datum));
    } else if (datum instanceof File) {
        const f = uploadIRI();
        const file = rdfFactory.quad(subject, predicate, f);
        blobs.push([f, datum as File]);
        graph.add(file);
    } else if (isPlainObject(datum)) {
        const id = datum["@id"] as SomeNode | undefined || rdfFactory.blankNode();
        blobs = blobs.concat(processDataObject(id, datum, graph));
        graph.add(subject, predicate, id);
    } else if (datum && datum.termType === TermType.NamedNode) {
        graph.add(subject, predicate, rdfFactory.namedNode(datum.value));
    } else if (datum && datum.termType === TermType.Literal) {
        graph.add(
            subject,
            predicate,
            rdfFactory.literal(
                datum.value,
                (datum as Literal).language || rdfFactory.namedNode((datum as Literal).datatype.value),
            ),
        );
    } else if (datum !== null && datum !== undefined) {
        graph.add(subject, predicate, rdfFactory.literal(datum));
    }

    return blobs;
}

function processDataObject(subject: Node, data: DataObject, graph: Store): NamedBlobTuple[] {
    let blobs: NamedBlobTuple[] = [];
    const keys = Object.keys(data);
    for (let i = 0; i < keys.length; i++) {
        if (keys[i] === "@id") { continue; }
        const predicate = expandProperty(keys[i], defaultNS);
        const datum = data[keys[i]];

        if (predicate === undefined) {
            throw new Error(`Unknown predicate ${keys[i]} given (for subject '${subject}').`);
        }

        blobs = blobs.concat(processObject(subject, predicate, datum, graph));
    }

    return blobs;
}

export function dataToGraphTuple(data: DataObject): DataTuple {
    const g = getGraph();

    const blobs = processDataObject(MAIN_NODE_DEFAULT_IRI, data, g);

    return [g, blobs];
}

/**
 * Convert a DataObject into a graph. Useful for writing test data in semi-plain JS objects
 * @param iriOrData The data object or an iri for the top-level object.
 * @param data The data object if an IRI was passed.
 * @param graph A graph to write the statements into.
 */
export function toGraph(iriOrData: SomeNode | DataObject, data?: DataObject, graph?: Store): ParsedObject {
    const passedIRI = iriOrData.termType === TermType.BlankNode || iriOrData.termType === TermType.NamedNode;
    if (passedIRI && !data) {
        throw new TypeError("Only an IRI was passed to `toObject`, a valid data object has to be the second argument");
    }
    const embeddedIRI = ((passedIRI ? data : iriOrData) as DataObject)!["@id"];
    let iri;
    if (embeddedIRI) {
        if (typeof embeddedIRI !== "string") {
            throw new TypeError("Embedded IRI (`@id`) value must be of type string");
        }
        iri = rdfFactory.namedNode(embeddedIRI);
    } else {
        iri = passedIRI ? (iriOrData as SomeNode) : rdfFactory.blankNode();
    }
    const dataObj = passedIRI ? data! : (iriOrData as DataObject);

    const g = graph || getGraph();

    const blobs = processDataObject(iri, dataObj, g);

    return [iri, g, blobs];
}
