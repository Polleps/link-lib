import rdfFactory from "@ontologies/core";
import * as schema from "@ontologies/schema";

import { getBasicStore } from "../../testUtilities";
import { SubscriptionRegistrationBase } from "../../types";

import { schemaT } from "./fixtures";

jest.useFakeTimers("legacy");

describe("LinkedRenderStore", () => {
    describe("subscriptions", () => {
        describe("in bulk", () => {
            it("registers the subscription", async () => {
                const store = getBasicStore();
                const callback = jest.fn();
                const reg = {
                    callback,
                    markedForDelete: false,
                    onlySubjects: false,
                };

                store.lrs.subscribe(reg);
                expect(callback).not.toHaveBeenCalled();
            });

            it("unregisters the subscription", async () => {
                const store = getBasicStore();
                const callback = jest.fn();
                const reg = {
                    callback,
                    markedForDelete: false,
                    onlySubjects: false,
                };

                const unregister = store.lrs.subscribe(reg);
                expect(reg.markedForDelete).toBeFalsy();
                unregister();
                expect(reg.markedForDelete).toBeTruthy();
            });

            it("calls the subscription", async () => {
                const store = getBasicStore();
                const callback = jest.fn();
                const reg = {
                    callback,
                    markedForDelete: false,
                    onlySubjects: false,
                };

                store.lrs.subscribe(reg);
                expect(callback).not.toHaveBeenCalled();

                await store.forceBroadcast();
                expect(callback).toHaveBeenCalled();
            });
        });

        describe("subject filtered", () => {
            it("registers the subscription", async () => {
                const store = getBasicStore();
                const callback = jest.fn();
                const reg = {
                    callback,
                    markedForDelete: false,
                    onlySubjects: true,
                    subjectFilter: [schemaT],
                };

                store.lrs.subscribe(reg);
                expect(callback).not.toHaveBeenCalled();
            });

            it("unregisters the subscription", async () => {
                const store = getBasicStore();
                (store.lrs as any).cleanupTimout = 0;
                const callback = jest.fn();
                const reg = {
                    callback,
                    markedForDelete: false,
                    onlySubjects: true,
                    subjectFilter: [schemaT],
                };

                const unregister = store.lrs.subscribe(reg);
                expect(reg.markedForDelete).toBeFalsy();
                expect(setTimeout).toHaveBeenCalledTimes(0);
                unregister();
                expect(setTimeout).toHaveBeenCalledTimes(1);
                expect(reg.markedForDelete).toBeTruthy();

                expect((store.lrs as any).subjectSubscriptions[`<${schemaT.value}>`]).toContain(reg);
                jest.runAllTimers();
                expect((store.lrs as any).subjectSubscriptions[`<${schemaT.value}>`]).not.toContain(reg);
            });

            it("skips the subscription when irrelevant", async () => {
                const store = getBasicStore();
                const callback = jest.fn();
                const reg = {
                    callback,
                    markedForDelete: false,
                    onlySubjects: true,
                    subjectFilter: [schemaT],
                };

                store.lrs.subscribe(reg);
                expect(callback).not.toHaveBeenCalled();

                await store.forceBroadcast();
                expect(callback).not.toHaveBeenCalled();
            });

            it("calls the subscription when relevant", async () => {
                jest.useRealTimers();

                const store = getBasicStore();
                await store.forceBroadcast();
                const callback = jest.fn();
                const reg = {
                    callback,
                    markedForDelete: false,
                    onlySubjects: true,
                    subjectFilter: [schemaT],
                } as SubscriptionRegistrationBase<any>;

                store.lrs.subscribe(reg);
                expect(callback).not.toHaveBeenCalled();

                store.store.addQuads([rdfFactory.quad(schemaT, schema.name, rdfFactory.literal("Thing"))]);
                await store.forceBroadcast();

                expect(callback).toHaveBeenCalledTimes(1);
                expect(callback.mock.calls[0][0]).toEqual([
                    rdfFactory.id(schemaT),
                    rdfFactory.id(store.store.defaultGraph()),
                ]);
                expect(callback.mock.calls[0][1]).toBeGreaterThanOrEqual(reg.subscribedAt!);
                expect(callback.mock.calls[0][1]).toBeLessThanOrEqual(Date.now());
            });
        });
    });
});
