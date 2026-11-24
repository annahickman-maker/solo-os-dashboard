import assert from "node:assert/strict";
import test from "node:test";
import { captureIntent, defaultPipelineStages, planDeal, type PipelineRow, type StageRow } from "./auto-deal.ts";

const pipelines: PipelineRow[] = [
  { id: "other", is_default: false, position: 0 },
  { id: "main", is_default: true, position: 1 },
];
const stages: StageRow[] = [
  { id: "o1", name: "Lead", position: 0, pipeline_id: "other" },
  { id: "m3", name: "Call Booked", position: 2, pipeline_id: "main" },
  { id: "m1", name: "New", position: 0, pipeline_id: "main" },
  { id: "m2", name: "Nurturing", position: 1, pipeline_id: "main" },
];
const main = defaultPipelineStages(pipelines, stages);

test("an enquiry is flagged by intent or by an enquiry or contact form", () => {
  assert.equal(captureIntent({ intent: "enquiry" }), "enquiry");
  assert.equal(captureIntent({ intent: "Inquiry" }), "enquiry");
  assert.equal(captureIntent({ form: "contact" }), "enquiry");
  assert.equal(captureIntent({ form: "work-with-me-enquiry" }), "enquiry");
  assert.equal(captureIntent({ form_type: "enquiry_form" }), "enquiry");
});

test("a plain newsletter sign-up is a subscribe", () => {
  assert.equal(captureIntent({}), "subscribe");
  assert.equal(captureIntent({ form: "newsletter" }), "subscribe");
  assert.equal(captureIntent({ form: "lead-magnet", source: "contact-page" }), "subscribe");
  // An explicit intent wins over a form name.
  assert.equal(captureIntent({ intent: "subscribe", form: "contact" }), "subscribe");
});

test("the default pipeline's stages come back in order", () => {
  assert.deepEqual(main.map((s) => s.id), ["m1", "m2", "m3"]);
  assert.deepEqual(
    defaultPipelineStages([{ id: "other", is_default: false, position: 0 }], stages).map((s) => s.id),
    ["o1"],
  );
  assert.deepEqual(defaultPipelineStages([], stages), []);
});

test("someone with no open deal gets one in the first stage", () => {
  assert.deepEqual(planDeal({ stages: main, openStageId: null, create: true }), { action: "create", stage: main[0] });
});

test("someone with an open deal never gets a second one", () => {
  assert.deepEqual(planDeal({ stages: main, openStageId: "m1", create: true }), { action: "exists" });
  assert.deepEqual(planDeal({ stages: main, openStageId: "o1", create: true }), { action: "exists" });
});

test("a booking files into the call stage and only ever moves a deal forward", () => {
  assert.deepEqual(planDeal({ stages: main, openStageId: null, wanted: "Call Booked", create: true }), {
    action: "create",
    stage: main[2],
  });
  assert.deepEqual(planDeal({ stages: main, openStageId: "m1", wanted: "call booked", create: true }), {
    action: "advance",
    stage: main[2],
  });
  assert.deepEqual(planDeal({ stages: main, openStageId: "m3", wanted: "Nurturing", create: true }), { action: "exists" });
});

test("an unknown stage name falls back to the first stage", () => {
  assert.deepEqual(planDeal({ stages: main, openStageId: null, wanted: "Lead", create: true }), { action: "create", stage: main[0] });
});

test("enrolling a subscriber in a sequence never opens a deal", () => {
  assert.deepEqual(planDeal({ stages: main, openStageId: null, wanted: "Nurturing", create: false }), { action: "skip" });
  assert.deepEqual(planDeal({ stages: main, openStageId: "m1", wanted: "Nurturing", create: false }), {
    action: "advance",
    stage: main[1],
  });
});

test("no pipeline means nothing to do", () => {
  assert.deepEqual(planDeal({ stages: [], openStageId: null, create: true }), { action: "no_pipeline" });
});
