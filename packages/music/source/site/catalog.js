// The catalog: situations the houseband can play for, the directory's families, and tags for the pieces
// written before pieces declared their own `situations` / `energy` (a piece's own fields win).
(function (root) {
  "use strict";
  const Sim = (root.Sim = root.Sim || {});
  Sim.catalog = {
    situations: [
      { id: "hangout", label: "Hanging out", hint: "chatting, lounging, a café" },
      { id: "party", label: "Party", hint: "dancing, the club" },
      { id: "fight", label: "Fight", hint: "combat, a boss" },
      { id: "chase", label: "Chase", hint: "racing, pursuit, action" },
      { id: "campfire", label: "Campfire", hint: "outdoors at night" },
      { id: "sleep", label: "Sleep", hint: "resting, winding down" },
      { id: "presentation", label: "Presentation", hint: "keynote, lobby, waiting room" },
      { id: "work", label: "Work", hint: "building, crafting, focus" },
      { id: "explore", label: "Explore", hint: "travel, wandering" },
      { id: "shopping", label: "Shopping", hint: "mall, market" },
      { id: "romance", label: "Romance", hint: "a date, a slow dance" },
      { id: "mystery", label: "Mystery", hint: "sneaking, suspense" },
      { id: "training", label: "Training", hint: "workout, the montage" },
      { id: "celebrate", label: "Celebrate", hint: "festival, awards, a win" },
    ],
    // directory grouping; pieces not listed land in "More"
    families: [
      ["Disco & house", ["mirror-ball", "roller-rink", "italo-nights", "magic-orbit", "hi-nrg", "filter-house", "warehouse", "neon-shibuya"]],
      ["New pieces", ["skylight-rain", "harbour-mouth", "branch-line", "lantern-square", "nightside-pass", "hydroponics-deck", "section-lines", "citronella", "heron-causeway", "second-ring-road", "sunken-causeway", "cheese-stall", "firn-light", "aerial-causeway", "service-corridor", "after-the-fireworks", "night-approach", "headland", "evening-rounds", "velour", "halogen", "cloud-street", "lamplighter", "frost-fair", "heat-lightning", "under-glass", "flying-junction", "coin-laundry", "clock-tower", "milonga-terrace", "ridge-road", "riverboat"]],
      ["Game music", ["line-clear", "grand-prix", "final-round", "pixel-town"]],
      ["80s & synthwave", ["night-patrol", "montage", "night-drive", "marina-district"]],
      ["Ambient & minimal", ["departure-lounge", "starfield", "tidepool", "petri-dish", "public-works", "traffic-grid", "green-world"]],
      ["Downtempo, lo-fi & vaporwave", ["lofi-study", "plaza-mall", "night-shift", "last-train", "home-movies"]],
      ["Jazz, soul & lounge", ["zoning-board", "overtime", "downtown-rush", "local-forecast", "noir", "slow-jam"]],
      ["Latin, Caribbean & Brazilian", ["carnival-samba", "mambo", "cumbia", "reggae", "budget-surplus", "tax-holiday", "island-resort"]],
      ["World percussion", ["afrobeat", "taiko-clash", "caravan", "second-line", "tribal-stage", "creature-lab", "rice-terraces", "dojo-garden"]],
      ["Folk & acoustic", ["campfire", "hill-farm"]],
      ["Breaks & bass", ["grid-runner"]],
      ["Screen & stage", ["night-watch", "spy-surf", "arena", "keynote", "quarterly-report", "lullaby"]],
      ["Chamber, baroque & fairground", ["build-mode", "buy-mode", "royal-charter", "midway"]],
      ["Space synth", ["orbital-survey", "terraform", "nightside-pass", "hydroponics-deck"]],
    ],
    tags: {
      "zoning-board": { situations: ["hangout", "romance", "presentation"], energy: 0.35 },
      "overtime": { situations: ["romance", "hangout"], energy: 0.25 },
      "budget-surplus": { situations: ["hangout", "shopping"], energy: 0.4 },
      "tax-holiday": { situations: ["romance", "hangout"], energy: 0.3 },
      "build-mode": { situations: ["work", "shopping"], energy: 0.35 },
      "buy-mode": { situations: ["shopping", "work"], energy: 0.4 },
      "public-works": { situations: ["work", "explore"], energy: 0.45 },
      "traffic-grid": { situations: ["work", "explore"], energy: 0.5 },
      "tidepool": { situations: ["sleep", "work"], energy: 0.1 },
      "petri-dish": { situations: ["sleep", "work"], energy: 0.12 },
      "creature-lab": { situations: ["explore", "hangout"], energy: 0.45 },
      "tribal-stage": { situations: ["celebrate", "campfire", "party"], energy: 0.7 },
      "orbital-survey": { situations: ["explore", "work"], energy: 0.5 },
      "terraform": { situations: ["explore", "work"], energy: 0.55 },
      "night-shift": { situations: ["hangout", "romance"], energy: 0.4 },
      "last-train": { situations: ["hangout", "mystery"], energy: 0.45 },
      "pixel-town": { situations: ["hangout", "explore"], energy: 0.5 },
      "marina-district": { situations: ["hangout", "party"], energy: 0.6 },
      "royal-charter": { situations: ["presentation", "work", "celebrate"], energy: 0.45 },
      "hill-farm": { situations: ["celebrate", "campfire", "party"], energy: 0.7 },
      "island-resort": { situations: ["hangout", "romance"], energy: 0.4 },
      "home-movies": { situations: ["hangout", "sleep"], energy: 0.3 },
      "rice-terraces": { situations: ["explore", "celebrate"], energy: 0.4 },
      "midway": { situations: ["celebrate", "shopping"], energy: 0.6 },
    },
  };
  /** All piece ids in directory order (the loader fetches these). */
  Sim.catalog.ids = () => Sim.catalog.families.flatMap(([, ids]) => ids);
})(typeof window !== "undefined" ? window : globalThis);
