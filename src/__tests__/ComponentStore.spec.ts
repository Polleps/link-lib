import "jest";
import "./useHashFactory";

import rdfFactory from "@ontologies/core";
import rdfs from "@ontologies/rdfs";
import schema from "@ontologies/schema";

import { ComponentStore } from "../ComponentStore";
import { RDFStore } from "../RDFStore";
import { Schema } from "../Schema";
import { getBasicStore } from "../testUtilities";
import { Indexable } from "../types";
import { DEFAULT_TOPOLOGY, RENDER_CLASS_NAME } from "../utilities/constants";

const DT = rdfFactory.id(DEFAULT_TOPOLOGY);
const RCN = rdfFactory.id(RENDER_CLASS_NAME);

describe("ComponentStore", () => {
    describe("registerRenderer", () => {
        it("fails without component", () => {
            expect(() => {
                ComponentStore.registerRenderer(
                    undefined,
                    [rdfFactory.id(schema.Thing)],
                    [RCN],
                    [DT],
                );
            }).toThrowError();
        });

        it("registers with full notation", () => {
            const comp = (): string => "a";
            const reg = ComponentStore.registerRenderer(
                comp,
                [rdfFactory.id(schema.Thing)],
                [RCN],
                [DT],
            );

            expect(reg).toEqual([{
                component: comp,
                property: RCN,
                topology: DT,
                type: rdfFactory.id(schema.Thing),
            }]);
        });

        it ("checks types for undefined values", () => {
            expect(() => {
                ComponentStore.registerRenderer(
                    () => undefined,
                    [rdfFactory.id(schema.Thing), undefined!],
                    [RCN],
                    [DT],
                );
            }).toThrowError(TypeError);
        });

        it ("checks properties for undefined values", () => {
            expect(() => {
                ComponentStore.registerRenderer(
                    () => undefined,
                    [rdfFactory.id(schema.Thing)],
                    [RCN, undefined!],
                    [DT],
                );
            }).toThrowError(TypeError);
        });

        it ("checks topologies for undefined values", () => {
            expect(() => {
                ComponentStore.registerRenderer(
                    () => undefined,
                    [rdfFactory.id(schema.Thing)],
                    [RCN],
                    [DT, undefined!],
                );
            }).toThrowError(TypeError);
        });

        it ("returns undefined when no property is given", () => {
            const store = getBasicStore();

            expect(store.mapping.registerRenderer(
                () => undefined,
                rdfFactory.id(schema.Thing),
                undefined,
                undefined,
            )).toBeUndefined();
        });
    });

    describe("getRenderComponent", () => {
        it("resolved with unregistered views", () => {
            const store = new ComponentStore(new Schema<Indexable>(new RDFStore()));
            const unregistered = rdfFactory.id(schema.url);
            const registered = rdfFactory.id(schema.name);

            const comp = (): string => "test";
            store.registerRenderer(comp, rdfFactory.id(schema.BlogPosting), registered);

            const lookup = store.getRenderComponent(
                [rdfFactory.id(schema.BlogPosting)],
                [unregistered, registered],
                rdfFactory.id(DEFAULT_TOPOLOGY),
                rdfFactory.id(rdfs.Resource),
            );

            expect(lookup).toEqual(comp);
        });
    });
});
