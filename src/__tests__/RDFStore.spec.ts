import "jest";
import "./useHashFactory";

import rdfFactory, { createNS, Quadruple } from "@ontologies/core";
import * as owl from "@ontologies/owl";
import * as rdf from "@ontologies/rdf";
import * as rdfs from "@ontologies/rdfs";
import * as schema from "@ontologies/schema";
import * as xsd from "@ontologies/xsd";

import ll from "../ontology/ll";
import { RDFStore } from "../RDFStore";
import RDFIndex from "../store/RDFIndex";
import { getBasicStore } from "../testUtilities";

const example = createNS("http://example.com/");
const ex = createNS("http://example.com/ns#");

const schemaT = schema.Thing;
const thingStatements = [
    rdfFactory.quad(schemaT, rdf.type, rdfs.Class, rdfFactory.defaultGraph()),
    rdfFactory.quad(schemaT, rdfs.comment, rdfFactory.literal("The most generic type"), rdfFactory.defaultGraph()),
    rdfFactory.quad(schemaT, rdfs.label, rdfFactory.literal("Thing."), rdfFactory.defaultGraph()),
];
const aboutIsThing = [
    rdfFactory.quad(schema.AboutPage, owl.sameAs, schemaT),
];
const thingIsAbout = [
    rdfFactory.quad(schemaT, owl.sameAs, schema.AboutPage),
];

describe("RDFStore", () => {
    describe("#addStatements", () => {
        it("requires an array", () => {
            const store = new RDFStore();

            expect(() => {
                store.addQuads("test" as any);
            }).toThrowError(TypeError);
        });

        it("works", () => {
            const store = new RDFStore();
            store.addQuads(thingStatements);

            const libStatements = store.getInternalStore().quads;
            expect(libStatements).toHaveLength(3);
            expect(libStatements[0]).toEqual(thingStatements[0]);
            expect(libStatements[1]).toEqual(thingStatements[1]);
            expect(libStatements[2]).toEqual(thingStatements[2]);
        });

        it("bumps the changeTimestamp", async () => {
            const store = getBasicStore();
            store.store.addQuads([
                thingStatements[0],
            ]);
            store.store.flush();
            const before = store.store.changeTimestamps[rdfFactory.id(schemaT)];

            await new Promise((resolve): void => { window.setTimeout(resolve, 100); });

            store.store.addQuads([
                thingStatements[1],
                thingStatements[2],
            ]);
            store.store.flush();
            expect(store.store.changeTimestamps[rdfFactory.id(schemaT)]).toBeGreaterThan(before);
        });

        describe("owl:sameAs", () => {
            describe("big small", () => {
                it("equates existing data", () => {
                    const store = getBasicStore();
                    store.store.addQuads(aboutIsThing);
                    store.store.addQuads(thingStatements);
                    expect(store.store.match(schema.AboutPage, rdfs.label, rdfFactory.literal("Thing."), null))
                        .toHaveLength(1);
                });

                it("equates new data", () => {
                    const store = getBasicStore();
                    store.store.addQuads(thingStatements);
                    store.store.addQuads(aboutIsThing);
                    expect(store.store.match(schema.AboutPage, rdfs.label, rdfFactory.literal("Thing."), null))
                        .toHaveLength(1);
                });
            });

            describe("small big", () => {
                it("equates existing data", () => {
                    const store = getBasicStore();
                    store.store.addQuads(thingIsAbout);
                    store.store.addQuads(thingStatements);
                    expect(store.store.match(schema.AboutPage, rdfs.label, rdfFactory.literal("Thing."), null))
                        .toHaveLength(1);
                });

                it("equates new data", () => {
                    const store = getBasicStore();
                    store.store.addQuads(thingStatements);
                    store.store.addQuads(thingIsAbout);
                    expect(store.store.match(schema.AboutPage, rdfs.label, rdfFactory.literal("Thing."), null))
                        .toHaveLength(1);
                });
            });
        });
    });

    describe("#flush", () => {
        it("is returns the work available", () => {
            const store = new RDFStore();
            store.addQuads(thingStatements);
            const res = store.flush();
            expect(res[0]).toEqual(thingStatements[0]);
            expect(res[1]).toEqual(thingStatements[1]);
            expect(res[2]).toEqual(thingStatements[2]);
        });

        it("is returns a frozen empty array without work", () => {
            const res = new RDFStore().flush();
            expect(res.length).toEqual(0);
            expect(Object.isFrozen(res)).toBeTruthy();
        });
    });

    describe("#getInternalStore", () => {
        it("returns the store", () => {
            expect(new RDFStore().getInternalStore()).toBeInstanceOf(RDFIndex);
        });
    });

    describe("#replaceMatches", () => {
        it("replaces a statement", () => {
            const store = new RDFStore();
            store.addQuads(thingStatements);

            const quads: Quadruple[] = [
                [schemaT, rdfs.label, rdfFactory.literal("Thing!"), ll.ns("replace")],
            ];

            const before = store.match(schemaT, rdfs.label, null, null);
            expect(before).toHaveLength(1);
            expect(before[0].object).toEqual(rdfFactory.literal("Thing."));

            store.replaceMatches(quads);

            const after = store.match(schemaT, rdfs.label, null, null);
            expect(after).toHaveLength(1);
            expect(after[0].object).toEqual(rdfFactory.literal("Thing!", undefined, xsd.string));
        });
    });

    describe("#processDelta", () => {
        it("handles empty values", () => {
            const store = new RDFStore();

            expect(store.processDelta(new Array(1))).toEqual([]);
        });

        describe("ll:replace", () => {
            it("replaces existing", () => {
                const store = new RDFStore();

                expect(store.processDelta(new Array(1))).toEqual([]);
            });
        });

        describe("ll:remove", () => {
            it("removes one", () => {
                const store = new RDFStore();
                store.addQuads(thingStatements);

                expect(store.match(null, null, null, null)).toHaveLength(thingStatements.length);

                const statements: Quadruple[] = [
                    [schemaT, rdfs.label, rdfFactory.literal("irrelevant"), ll.ns("remove")],
                ];

                store.processDelta(statements);

                expect(store.match(null, null, null, null)).toHaveLength(thingStatements.length - 1);
                expect(store.match(schemaT, rdfs.label, null, null)).toHaveLength(0);
            });

            it("removes many", () => {
                const store = new RDFStore();
                store.addQuads(thingStatements);
                store.addQuads([rdfFactory.quad(schemaT, rdfs.label, rdfFactory.literal("Thing gb", "en-gb"))]);

                expect(store.match(null, null, null, null)).toHaveLength(thingStatements.length + 1);

                const quads: Quadruple[] = [
                    [schemaT, rdfs.label, rdfFactory.literal("irrelevant"), ll.ns("remove")],
                ];

                store.processDelta(quads);

                expect(store.match(null, null, null, null)).toHaveLength(thingStatements.length - 1);
                expect(store.match(schemaT, rdfs.label, null, null)).toHaveLength(0);
            });
        });
    });

    describe("#replaceStatements", () => {
        it("replaces statements", () => {
            const old = [rdfFactory.quad(ex("a"), ex("p"), ex("x"), ex("g"))];
            const next = [rdfFactory.quad(ex("a"), ex("q"), ex("x"), ex("g"))];
            const store = new RDFStore();
            store.addQuads(old);
            store.replaceQuads(old, next);

            expect(store.match(null, null, null, null)).toHaveLength(1);
            expect(store.match(ex("a"), null, null, null)[0]).toEqual(next[0]);
        });
    });

    describe("#getResourcePropertyRaw", () => {
        const store = new RDFStore();
        store.addQuads([
            rdfFactory.quad(ex("a"), ex("p"), ex("x")),
            rdfFactory.quad(ex("a"), ex("r"), ex("y")),

            rdfFactory.quad(ex("b"), ex("p"), ex("xx")),
            rdfFactory.quad(ex("b"), ex("p"), ex("yy")),
        ]);

        it("resolves empty values for single property", () => {
            expect(store.getResourcePropertyRaw(ex("none"), ex("p")))
                .toEqual([]);
        });

        it("resolves empty values for multiple properties", () => {
            expect(store.getResourcePropertyRaw(ex("none"), [ex("p"), ex("q")]))
                .toEqual([]);
        });

        it("resolves values for single property", () => {
            expect(store.getResourcePropertyRaw(ex("b"), ex("p")))
                .toEqual([
                    rdfFactory.quad(ex("b"), ex("p"), ex("xx"), rdfFactory.namedNode("rdf:defaultGraph")),
                    rdfFactory.quad(ex("b"), ex("p"), ex("yy"), rdfFactory.namedNode("rdf:defaultGraph")),
                ]);
        });

        it("resolves value for multiple properties one existent", () => {
            expect(store.getResourcePropertyRaw(ex("a"), [ex("p"), ex("q")]))
                .toEqual([
                    rdfFactory.quad(ex("a"), ex("p"), ex("x"), rdfFactory.namedNode("rdf:defaultGraph")),
                ]);
        });

        it("resolves value for multiple properties multiple existent", () => {
            expect(store.getResourcePropertyRaw(ex("a"), [ex("r"), ex("p")]))
                .toEqual([
                    rdfFactory.quad(ex("a"), ex("r"), ex("y"), rdfFactory.namedNode("rdf:defaultGraph")),
                ]);
        });
    });

    describe("#getResourceProperty", () => {
        it("returns undefined for type statements on unloaded resources", () => {
            const store = new RDFStore();

            expect(store.getResourceProperty(ex("1"), rdf.type)).toBeUndefined();
        });

        it("returns the type for type statements", () => {
            const store = new RDFStore();
            store.addQuads([
                rdfFactory.quad(ex("2"), rdf.type, ex("SomeClass")),
            ]);

            expect(store.getResourceProperty(ex("2"), rdf.type))
                .toEqual(ex("SomeClass"));
        });

        it("returns undefined for other statements on unloaded resources", () => {
            const store = new RDFStore();

            expect(store.getResourceProperty(ex("1"), ex("prop"))).toBeUndefined();
        });

        it("returns the object for other statements", () => {
            const store = new RDFStore();
            store.addQuads([
                rdfFactory.quad(ex("2"), ex("prop"), rdfFactory.literal("some prop")),
            ]);

            expect(store.getResourceProperty(ex("2"), ex("prop")))
                .toEqual(rdfFactory.literal("some prop"));
        });

        it("picks the preferred language", () => {
            const store = new RDFStore();
            store.addQuads([
                rdfFactory.quad(ex("2"), ex("prop"), rdfFactory.literal("some prop", "de")),
                rdfFactory.quad(ex("2"), ex("prop"), rdfFactory.literal("some prop", "nl")),
                rdfFactory.quad(ex("2"), ex("prop"), rdfFactory.literal("some prop", "en")),
                rdfFactory.quad(ex("2"), ex("prop"), rdfFactory.literal("some prop", "fr")),
            ]);

            expect(store.getResourceProperty(ex("2"), ex("prop")))
                .toEqual(rdfFactory.literal("some prop", "en"));
        });
    });

    describe("#processTypeStatement", () => {
        it("initializes new resources", () => {
            const store = new RDFStore();

            expect(store.typeCache[rdfFactory.id(ex("1"))]).toBeUndefined();
            store.addQuads([
                rdfFactory.quad(ex("1"), rdf.type, ex("type"), ex("_")),
            ]);
            expect(store.typeCache[rdfFactory.id(ex("1"))]).toEqual([ex("type")]);
        });

        it("adds new types for cached resources", () => {
            const store = new RDFStore();
            store.addQuads([
                rdfFactory.quad(ex("1"), rdf.type, ex("type"), ex("_")),
                rdfFactory.quad(ex("1"), rdf.type, ex("type2"), ex("_")),
            ]);

            expect(store.typeCache[rdfFactory.id(ex("1"))]).toEqual([ex("type"), ex("type2")]);
        });

        it("removes type statements after they are removed from the store", () => {
            const store = new RDFStore();
            store.addQuads([
                rdfFactory.quad(ex("1"), rdf.type, ex("type"), ex("_")),
                rdfFactory.quad(ex("1"), rdf.type, ex("type2"), ex("_")),
            ]);
            store.removeQuads([rdfFactory.quad(ex("1"), rdf.type, ex("type"), ex("_"))]);
            store.flush();

            expect(store.typeCache[rdfFactory.id(ex("1"))]).toEqual([ex("type2")]);
        });
    });

    describe("#rdfFactory", () => {
        it("returns the @ontologies/core factory", () => {
            expect(new RDFStore().rdfFactory).toBe(rdfFactory);
        });

        it("throws setting the factory", () => {
            const store = new RDFStore();
            expect(() => {
                store.rdfFactory = {} as any;
            }).toThrow();
        });
    });

    describe("#removeResource", () => {
        it("bumps the changeTimestamp", async () => {
            const store = getBasicStore();
            const resource = example("test");
            store.store.addQuads([
                rdfFactory.quad(resource, rdf.type, schema.Person),
            ]);
            store.store.flush();
            const before = store.store.changeTimestamps[rdfFactory.id(resource)];

            await new Promise((resolve): void => { window.setTimeout(resolve, 100); });

            store.store.removeResource(resource);
            expect(store.store.changeTimestamps[rdfFactory.id(resource)]).toBeGreaterThan(before);
        });

        it("clears the type cache", () => {
            const store = getBasicStore();
            const resource = example("test");
            store.store.addQuads([
                rdfFactory.quad(resource, rdf.type, schema.Person),
            ]);

            expect(store.store.typeCache[rdfFactory.id(resource)]).toHaveLength(1);
            store.store.removeResource(resource);
            expect(store.store.typeCache[rdfFactory.id(resource)]).toHaveLength(0);
        });

        it("removes the resource data", () => {
            const store = getBasicStore();
            const resource = example("test");
            store.store.addQuads([
                rdfFactory.quad(resource, rdf.type, schema.Person),
                rdfFactory.quad(resource, schema.name, rdfFactory.literal("Name")),
                rdfFactory.quad(resource, schema.author, ex("3")),
                rdfFactory.quad(example("other"), schema.author, ex("3")),
            ]);

            expect(store.store.quadsFor(resource)).toHaveLength(3);
            store.store.removeResource(resource);
            expect(store.store.quadsFor(resource)).toHaveLength(0);
        });

        describe("owl:sameAs", () => {
            describe("big small", () => {
                it("equal before", () => {
                    const store = getBasicStore();
                    store.store.addQuads(aboutIsThing);
                    store.store.addQuads(thingStatements);

                    store.store.removeResource(schema.AboutPage);

                    expect(store.store.match(schema.AboutPage, rdfs.label, rdfFactory.literal("Thing."), null))
                        .toHaveLength(0);
                    expect(store.store.match(schemaT, rdfs.label, rdfFactory.literal("Thing."), null))
                        .toHaveLength(0);
                });

                it("equal after", () => {
                    const store = getBasicStore();
                    store.store.addQuads(thingStatements);
                    store.store.addQuads(aboutIsThing);

                    store.store.removeResource(schemaT);

                    expect(store.store.match(schema.AboutPage, rdfs.label, rdfFactory.literal("Thing."), null))
                        .toHaveLength(0);
                    expect(store.store.match(schemaT, rdfs.label, rdfFactory.literal("Thing."), null))
                        .toHaveLength(0);
                });
            });

            describe("small big", () => {
                it("equal before", () => {
                    const store = getBasicStore();
                    store.store.addQuads(thingIsAbout);
                    store.store.addQuads(thingStatements);

                    store.store.removeResource(schema.AboutPage);

                    expect(store.store.match(schema.AboutPage, rdfs.label, rdfFactory.literal("Thing."), null))
                        .toHaveLength(0);
                    expect(store.store.match(schemaT, rdfs.label, rdfFactory.literal("Thing."), null))
                        .toHaveLength(0);
                });

                it("equal after", () => {
                    const store = getBasicStore();
                    store.store.addQuads(thingStatements);
                    store.store.addQuads(thingIsAbout);

                    store.store.removeResource(schemaT);

                    expect(store.store.match(schema.AboutPage, rdfs.label, rdfFactory.literal("Thing."), null))
                        .toHaveLength(0);
                    expect(store.store.match(schemaT, rdfs.label, rdfFactory.literal("Thing."), null))
                        .toHaveLength(0);
                });
            });
        });
    });

    describe("#workAvailable", () => {
        it("is zero without work", () => {
            expect(new RDFStore().workAvailable()).toEqual(0);
        });

        it("is more than zero work", () => {
            const store = new RDFStore();
            expect(store.workAvailable()).toEqual(0);
            store.addQuads(thingStatements);
            expect(store.workAvailable()).toEqual(3);
        });

        it("is reset after #flush()", () => {
            const store = new RDFStore();
            store.addQuads(thingStatements);
            expect(store.workAvailable()).toEqual(3);
            store.flush();
            expect(store.workAvailable()).toEqual(0);
        });
    });
});
