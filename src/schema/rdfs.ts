import rdfFactory, {
    HexPos,
    Hextuple,
    isResource,
    NamedNode,
    Resource,
} from "@ontologies/core";
import rdf from "@ontologies/rdf";
import rdfs from "@ontologies/rdfs";

import { VocabularyProcessingContext, VocabularyProcessor } from "../types";

/**
 * Implements the RDF/RDFS axioms and rules.
 * @type {VocabularyProcessor}
 */
export const RDFS = {
    axioms: [
        rdfFactory.quad(rdf.type, rdfs.domain, rdfs.Resource),
        rdfFactory.quad(rdfs.domain, rdfs.domain, rdf.Property),
        rdfFactory.quad(rdfs.range, rdfs.domain, rdf.Property),
        rdfFactory.quad(rdfs.subPropertyOf, rdfs.domain, rdf.Property),
        rdfFactory.quad(rdfs.subClassOf, rdfs.domain, rdfs.Class),
        rdfFactory.quad(rdf.subject, rdfs.domain, rdf.Statement),
        rdfFactory.quad(rdf.predicate, rdfs.domain, rdf.Statement),
        rdfFactory.quad(rdf.object, rdfs.domain, rdf.Statement),
        rdfFactory.quad(rdfs.member, rdfs.domain, rdfs.Resource),
        rdfFactory.quad(rdf.first, rdfs.domain, rdf.List),
        rdfFactory.quad(rdf.rest, rdfs.domain, rdf.List),
        rdfFactory.quad(rdfs.seeAlso, rdfs.domain, rdfs.Resource),
        rdfFactory.quad(rdfs.isDefinedBy, rdfs.domain, rdfs.Resource),
        rdfFactory.quad(rdfs.comment, rdfs.domain, rdfs.Resource),
        rdfFactory.quad(rdfs.label, rdfs.domain, rdfs.Resource),
        rdfFactory.quad(rdf.value, rdfs.domain, rdfs.Resource),

        rdfFactory.quad(rdf.type, rdfs.range, rdfs.Class),
        rdfFactory.quad(rdfs.domain, rdfs.range, rdfs.Class),
        rdfFactory.quad(rdfs.range, rdfs.range, rdfs.Class),
        rdfFactory.quad(rdfs.subPropertyOf, rdfs.range, rdf.Property),
        rdfFactory.quad(rdfs.subClassOf, rdfs.range, rdfs.Class),
        rdfFactory.quad(rdf.subject, rdfs.range, rdfs.Resource),
        rdfFactory.quad(rdf.predicate, rdfs.range, rdfs.Resource),
        rdfFactory.quad(rdf.object, rdfs.range, rdfs.Resource),
        rdfFactory.quad(rdfs.member, rdfs.range, rdfs.Resource),
        rdfFactory.quad(rdf.first, rdfs.range, rdfs.Resource),
        rdfFactory.quad(rdf.rest, rdfs.range, rdf.List),
        rdfFactory.quad(rdfs.seeAlso, rdfs.range, rdfs.Resource),
        rdfFactory.quad(rdfs.isDefinedBy, rdfs.range, rdfs.Resource),
        rdfFactory.quad(rdfs.comment, rdfs.range, rdfs.Literal),
        rdfFactory.quad(rdfs.label, rdfs.range, rdfs.Literal),
        rdfFactory.quad(rdf.value, rdfs.range, rdfs.Resource),

        rdfFactory.quad(rdf.Alt, rdfs.subClassOf, rdfs.Container),
        rdfFactory.quad(rdf.Bag, rdfs.subClassOf, rdfs.Container),
        rdfFactory.quad(rdf.Seq, rdfs.subClassOf, rdfs.Container),
        rdfFactory.quad(rdfs.ContainerMembershipProperty, rdfs.subClassOf, rdf.Property),

        rdfFactory.quad(rdfs.isDefinedBy, rdfs.subPropertyOf, rdfs.seeAlso),

        rdfFactory.quad(rdfs.Datatype, rdfs.subClassOf, rdfs.Class),

        rdfFactory.quad(rdfs.Resource, rdf.type, rdfs.Class),
        rdfFactory.quad(rdfs.Class, rdf.type, rdfs.Class),
    ],

    processStatement(item: Hextuple, ctx: VocabularyProcessingContext): Hextuple[] | null {
        const result = [item];

        const domainStatements = ctx.store.matchHex(item[HexPos.predicate], rdfs.domain, null, null, null, null);
        if (domainStatements.length > 0) {
            for (let i = 0; i < domainStatements.length; i++) {
                result.push(rdfFactory.hextuple(
                    item[HexPos.subject],
                    rdf.type,
                    domainStatements[i][HexPos.object],
                    domainStatements[i][HexPos.objectDT],
                    domainStatements[i][HexPos.objectLang],
                ));
            }
        }

        const rangeStatements = ctx.store.matchHex(item[HexPos.predicate], rdfs.range, null, null, null, null);
        if (rangeStatements.length > 0) {                                                     // P rdfs:range C..Cn
            for (let i = 0; i < rangeStatements.length; i++) {
                result.push(rdfFactory.hextuple(
                    item[HexPos.object],
                    rdf.type,
                    rangeStatements[i][HexPos.object],
                    rangeStatements[i][HexPos.objectDT],
                    rangeStatements[i][HexPos.objectLang],
                ));
            }
        }

        if (rdfs.domain === item[HexPos.predicate]) {
            result.push(rdfFactory.quad(item[HexPos.subject], rdf.type, rdf.Property));     // P rdf:type rdf:Property
            result.push(rdfFactory.quad(item[HexPos.object], rdf.type, rdfs.Class));        // C rdf:type rdfs:Class

            const dereferences = ctx.store.matchHex(item[HexPos.subject], null, null, null, null, null);
            for (let i = 0; i < dereferences.length; i++) {
                result.push(rdfFactory.hextuple(
                    item[HexPos.subject],
                    rdf.type,
                    dereferences[i][HexPos.object],
                    dereferences[i][HexPos.objectDT],
                    dereferences[i][HexPos.objectLang],
                ));
            }

            if (item[HexPos.subject] !== rdf.type) {
                ctx.dataStore.getInternalStore().newPropertyAction(
                    item[HexPos.subject],
                    (quad: Hextuple) => {
                        ctx.store.addHextuples([rdfFactory.quad(
                            quad[HexPos.subject],
                            rdf.type,
                            item[HexPos.object],
                            item[HexPos.objectDT],
                            item[HexPos.objectLang],
                        )]);
                        return true;
                    },
                );
            }
        } else if (rdfs.range === item[HexPos.predicate]) {
            result.push(rdfFactory.quad(item[HexPos.subject], rdf.type, rdf.Property));     // P rdf:type rdf:Property
            result.push(rdfFactory.quad(item[HexPos.object], rdf.type, rdfs.Class));        // C rdf:type rdfs:Class

            const dereferences = ctx.store.matchHex(null, null, item[HexPos.subject], null, null, null);
            for (let i = 0; i < dereferences.length; i++) {
                result.push(rdfFactory.quad(dereferences[i][HexPos.subject], rdf.type, item[HexPos.object]));
            }

            if (item[HexPos.subject] !== rdf.type) {
                ctx.dataStore.getInternalStore().newPropertyAction(
                    item[HexPos.subject],
                    (quad: Hextuple) => {
                        ctx.store.addHextuples([rdfFactory.quad(
                            quad[HexPos.object],
                            rdf.type,
                            item[HexPos.object],
                        )]);
                        return true;
                    },
                );
            }
        } else if (rdfs.subClassOf === item[HexPos.predicate]) {            // C1 rdfs:subClassOf C2
            if (!isResource(item[HexPos.object])) {
                throw new Error("Object of subClassOf statement must be a NamedNode");
            }

            const iSubject = item[HexPos.subject];
            const iObject = item[HexPos.object];
            if (!ctx.superMap.has(iObject)) {
                ctx.superMap.set(iObject, new Set([rdfs.Resource]));
            }

            let parents = ctx.superMap.get(iObject);
            if (parents === undefined) {
                parents = new Set();
                ctx.superMap.set(iObject, parents);
            }
            parents.add(iObject);
            const itemVal = ctx.superMap.get(iSubject) || new Set<Resource>([iSubject]);

            parents.forEach((i) => itemVal.add(i));

            ctx.superMap.set(iSubject, itemVal);
            ctx.superMap.forEach((v, k) => {
                if (k !== iSubject && v.has(iSubject)) {
                    itemVal.forEach(v.add, v);
                }
            });
        } else if (rdfs.subPropertyOf === item[HexPos.predicate]) {
            // TODO: Implement
            return result;
        }

        return result.length === 1 ? null : result;
    },

    processType(type: NamedNode, ctx: VocabularyProcessingContext): boolean {
        RDFS.processStatement(rdfFactory.quad(type, rdfs.subClassOf, rdfs.Resource), ctx);
        ctx.store.addHextuples([rdfFactory.quad(type, rdf.type, rdfs.Class)]);
        return false;
    },
} as VocabularyProcessor;
