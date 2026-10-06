import { describe, expect, it } from "vitest";
import { headNoun, rejectTarget } from "./filters";

const small = { x: 0.4, y: 0.4, w: 0.05, h: 0.05 };

describe("headNoun", () => {
  it.each([
    ["Black metal park bench with curved back supports", "bench"],
    ["Patch of yellowing leaves on the grass verge", "leaves"],
    ["Dark, dense foliage mass behind the bright tree", "mass"],
    ["Clock tower atop the main administrative building", "tower"],
    ["Small green sign with house number 692", "sign"],
    ["wall-mounted plaque with a date", "plaque"],
    ["bright orange autumn foliage", "foliage"],
    ["Bright yellow umbrella covering outdoor seating area", "umbrella"],
    ["Hanging red flowers in a window box", "flowers"],
    ["Small arched stone bridge structure spanning the river", "bridge"],
    ["Patches of bright green moss covering the slope", "moss"],
    ["Small wooden garden structure with a dark top", "garden"],
    ["Small, dense cluster of bright green bushes on the slope", "bushes"],
    ["tall stone obelisk rising from a fountain with white marble sculptures", "obelisk"],
    ["Small, bright green sapling growing in the mossy hillside", "sapling"],
    ["Dark metal railing with decorative chain", "railing"],
    ["Painted mural showing a bird", "mural"],
  ])("%s → %s", (label, noun) => {
    expect(headNoun(label)).toBe(noun);
  });
});

describe("rejectTarget", () => {
  it("keeps pointable objects", () => {
    expect(rejectTarget("Small green sign with house number 692", small)).toBeUndefined();
    expect(rejectTarget("Hanging red flowers in a window box", small)).toBeUndefined();
    expect(rejectTarget("Small wooden garden structure with a dark top", small)).toBeUndefined();
    expect(rejectTarget("small bronze figure of a dog on a plinth", small)).toBeUndefined();
  });

  it("rejects areas and masses", () => {
    expect(rejectTarget("bright orange autumn foliage", small)).toBe("mass_noun");
    expect(rejectTarget("paved stone walkway path", small)).toBe("mass_noun");
    expect(rejectTarget("Light-colored rectangular building facade with many windows", small)).toBe("mass_noun");
    expect(rejectTarget("Small arched stone bridge structure spanning the river", small)).toBe("mass_noun");
    expect(rejectTarget("Patches of bright green moss covering the slope", small)).toBe("mass_noun");
  });

  it("rejects people", () => {
    expect(rejectTarget("man in a red jacket reading", small)).toBe("person");
    expect(rejectTarget("child's face painted on a wall", small)).toBe("person");
  });

  it("rejects animals and vehicles, which can leave", () => {
    expect(rejectTarget("dark duck resting on the large central rock", small)).toBe("animal");
    expect(rejectTarget("Bicycle parked near the edge of the paved area", small)).toBe("vehicle");
    expect(rejectTarget("White vehicle parked in the distance", small)).toBe("vehicle");
    expect(rejectTarget("Blue hatchback parked near the center of the road", small)).toBe("vehicle");
  });

  it("keeps fixtures named after animals or vehicles", () => {
    expect(rejectTarget("wooden bird house on a pole", small)).toBeUndefined();
    expect(rejectTarget("curved steel bike rack", small)).toBeUndefined();
    expect(rejectTarget("bronze duck statue", small)).toBeUndefined();
    expect(rejectTarget("yellow bus stop sign", small)).toBeUndefined();
  });

  it("rejects boxes larger than 15% of the frame", () => {
    expect(rejectTarget("old wooden gazebo", { x: 0, y: 0, w: 0.5, h: 0.4 })).toBe("too_large");
  });
});
