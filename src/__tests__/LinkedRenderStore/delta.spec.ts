import rdfFactory, { Hextuple } from "@ontologies/core";

import { getBasicStore } from "../../testUtilities";

import { ex, ld } from "./fixtures";

describe("LinkedRenderStore", () => {
    describe("#queueDelta", () => {
        const quadDelta = [
            rdfFactory.quad(ex("1"), ex("p"), ex("2"), ld.add),
            rdfFactory.quad(ex("1"), ex("t"), rdfFactory.literal("Test"), ld.add),
            rdfFactory.quad(ex("2"), ex("t"), rdfFactory.literal("Value"), ld.add),
        ] as Hextuple[];

        it("queues an empty delta", async () => {
            const store = getBasicStore();

            await store.lrs.queueDelta([]);
        });

        it("queues a quadruple delta", async () => {
            const processor = {
                flush: jest.fn(),
                processDelta: jest.fn(),
                queueDelta: jest.fn(),
            };
            const store = getBasicStore();
            store.lrs.deltaProcessors.push(processor);

            await store.lrs.queueDelta(quadDelta);

            expect(processor.queueDelta).toHaveBeenCalledTimes(1);
            expect(processor.queueDelta).toHaveBeenCalledWith(
                quadDelta,
                [ex("1"), ex("2")],
            );
        });

        it("queues a statement delta", async () => {
            const processor = {
                flush: jest.fn(),
                processDelta: jest.fn(),
                queueDelta: jest.fn(),
            };
            const store = getBasicStore();
            store.lrs.deltaProcessors.push(processor);

            const delta = [
                rdfFactory.quad(ex("1"), ex("p"), ex("2"), ld.add),
                rdfFactory.quad(ex("1"), ex("t"), rdfFactory.literal("Test"), ld.add),
                rdfFactory.quad(ex("2"), ex("t"), rdfFactory.literal("Value"), ld.add),
            ];
            await store.lrs.queueDelta(delta);

            expect(processor.queueDelta).toHaveBeenCalledTimes(1);
            expect(processor.queueDelta).toHaveBeenCalledWith(
                quadDelta,
                [ex("1"), ex("2")],
            );
        });
    });
});
