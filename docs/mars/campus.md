# The Mars campus: buildings, places and rhythms

The Mars engine was built to model the Mars College campus, a rack-and-plywood desert campus that is rebuilt a little
differently every year. Souls' Mars world is the 2026 campus. This page says what each building and place is, so that
gods and Souls (and the people reading their logs) know what a name refers to.

Sources in the code: the building defs in `packages/world-compiler/src/core-kit/mars.json` (`core/mars-*`), the world
template `worlds/templates/mars-two.json` (placement and each place's god-authored `about`: title, what it is,
aliases), and the year notes in `mars/viewer/app/history/scenes.ts`. When they disagree with this page, they win.

## The 2026 campus

| Name (ref) | What it is | Rooms and parts agents can name |
|---|---|---|
| **Chiba** (`chiba`) | The big rack-and-plywood building at the centre of the campus: the presentation and arts building, with solar panels and a mural on the auditorium. Aliases: auditorium, presentation hall, lecture hall. | the auditorium with the presenter's timber box and podium desk seat facing four audience tiers (bleachers); the classroom table; the gallery and its stairs, with the gallery monitors; the hall projection; the Marzipan laptop desk; the field outside with a fire bowl and a beanbag |
| **Kitchen and dining hall** (`kitchen`) | The shared meal building under the Chiba gallery, west of Mimos, on a raised plywood floor with steps up to a blue door on the south. Aliases: kitchen, dining hall, canteen, mess hall. | `working-kitchen`: perimeter counters, twin sinks, the long stainless prep table, fridges and a chest freezer; `dining-hall`: the blue wall, tables and reused bus seats; `entrance`, at the foot of the diner steps |
| **Mimos** (`mimos`) | The campus café, study lounge and tea room, an L-shaped building. Aliases: café, coffee house, tea room, study lounge. | `main`: the raised coffee and study bay with the coffee counter, the MIMOS sign and the study table; `main-south`: the ground-level lounge by the glazing (red sofa, recliner, coffee table); `floor`: the glazed tea room with the honey sofa, tea stools, a mat and a low table |
| **Showers** (`showers`) | The shared wash building: two wooden shower bays north-east of Mimos, doors on the south. Aliases: washrooms, bathhouse. | `shower-1`, `shower-2` (Shower Room One and Two) |
| **Dojo** (`dojo`) | The north rack building, for exercise and practice: an open interior for movement, not a café or lecture hall. Aliases: gym, exercise hall, practice hall. | open floor |
| **Tool Camp and Library** (`tool-camp`) | The north workshops: workbenches, a vise and tool storage, plus the tool library's reading corner up a timber stair on its east terrace and loft. Aliases: workshop, tool library, library. | the workshop bench and bench vise; the library bookshelf, low table and floor cushions; `tool-library-stair` |
| **Freeside and CoLab** (`freeside`) | The north-east compound for living and making: Freeside, the living house with a reused LIBRARY façade and a kitchen enclosure, and Bodywork/CoLab with roof access and small CoLab huts. Aliases: CoLab, Bodywork, living house. | the Freeside lounge (lime sofa, mattresses), the DJ table by the speakers, the CoLab sofa, a hydroponic cart |
| **West Racks** (`west-racks`) | A rack-built shelter at the far west edge of the campus, a landmark for finding the outlying camp. | none |
| **OG** (`og-*`) | An outlying camp on the west side: a clubhouse with sofas and a low blue table, an outdoor kitchen with a breakfast griddle cart and a worktop, folding dinner tables and chairs, a short bus and a boat. | furniture only |
| **Swimming pond** (`campus-swimming-pond`) | A body of water beside the main campus for swimming; approach the bank before entering. Not the water tank. | its bank |
| **Water tank and garden** (`water-tank`, `garden-bed`) | A storage tank serving the garden area, with planted beds and a watering can beside them. | fill a can at the tank, water a bed |
| **Desert Tire Track** (`tire-ring`) | An elliptical ring of half-buried tires marking an old dirt racetrack in the open desert: an outdoor landmark. | none |

Around these are parked vans and vehicles, trailers, two forklifts, two boats, toilets and shelters, and creosote scrub and
tire trails on the open ground toward the wash. Interiors that the reference does not show are not walkable by rule
([campus-scene.md](campus-scene.md)).

## Earlier years

The engine also carries one scene per earlier campus year ([history.md](history.md)). Building names change from year
to year even where the component ids stay the same.

| Year | The campus |
|---|---|
| 2020 | Portal, Forest and the public installations, with a separate trailer circle and the tire ring. |
| 2021 | Two parallel rack wings with a bare-ground corridor, draped aluminet and stepped platforms inside the wings. |
| 2022 | Four houses around an asymmetric courtyard: **Ba Sing Se** (the Chiba ids), **Cahuilla** (`east-house`), **Chatsubo** (`kitchen`) and **Huaqiangbei** (`west-house`), with broad rack stairs and seven travel trailers. |
| 2023 | A seven-bay **Chiba** with internal stepped access and 20 solar modules; **Rotapolis** parallel to it across the rear courtyard (one tall and one low event bay); **Robin's Nest**, a suspended hexagonal cabin (the Hexapod) in the west bay; a café bay. |
| 2024 | A six-bay Chiba roof with a lower west terrace, the auditorium and north entrance, a plexiglass solarium on the front, open rack seating, and Freeside's roof and tents. |
| 2025 | Chiba and Tool Camp facing a common courtyard, Freeside to the west, and **Bodywork** as its own low dojo closing the east side. |

## Rhythms and recurring events

The campus has a daily rhythm and a set of recurring gatherings. In Souls' Mars worlds they are customs, invitations
rather than schedules (`worlds/mars/world.json`); the Mars engine can also stage them as activities and scenarios
([social.md](social.md), [lab.md](lab.md)).

- **Mornings:** warming up and tending the garden after first light; coffee and study in Mimos.
- **Supper:** anyone may host supper in the kitchen when the light turns gold; a supper bell is the reminder. Meals
  are prepared in the working kitchen, eaten in the dining hall and cleaned up after.
- **The fire:** evenings round the fire bowl in Chiba's field, with seats in a circle.
- **Talks and classes:** presentations from the podium to the tiers in Chiba's auditorium; classroom conversations at
  the classroom table; viewing in the gallery.
- **Making and building:** work and repair at Tool Camp; build days where crews carry racks, beams, joists and
  plywood from material piles to raise a bay, lay decks and stairs, install and paint solar panels.
- **Reading, music and movement:** the reading corner in the tool library and reading circles; jams and DJ sets at
  Freeside; dance, yoga and practice in the Dojo.
- **Rest:** sleeping at night; quiet work is welcome any time.
