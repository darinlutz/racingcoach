# Validation notes: porsche-919-hybrid

Traced drawings from the Lovable project darinlutz/five-more-fast-cars, converted by scripts/importTracedCarDrawings.mjs.
Model: “2015 Porsche 919 Hybrid LMP1-H” by Ddiaz Design (https://sketchfab.com/ddiaz-design) (https://sketchfab.com/3d-models/2015-porsche-919-hybrid-lmp1-h-daf65582e2374ee9acb968eac5182722), CC-BY-NC-SA-4.0.

The source renders face the other way from this site's conventions: its left-side file (nose at screen-right) is used as the right side and its right-side file as the left side, and its top view (nose at the bottom) is turned 180 degrees. Prototypes are close to symmetric, but check the sides' details before activating.

## Anchors
- Side views: wheel centres, radii and contact patches measured from the drawings (the circle on the ground line most drawn pixels lie on; left side 100% and 100% of its points on lines, right side 100% and 100%). Their tire and rim outlines are in the wheels layer.
- Top, front and rear views: wheel centres ESTIMATED from the side view through each view's scale and a half track that is a share of the car's width, as these views hide or crop the tires. Their wheels stay in the body layer. Check them with the SVG debug switch before activating.
- No ride height reference points, splitter, diffuser or wing anchors.
- Not to scale: each view was fitted to its own 2400x1400 canvas.

## From the source project (please review)
| Car | Model used | Licence | Note |
|---|---|---|---|
| Toyota GR86 | 2022 Pandem GR86 V1.5 Aero Kit — Ddiaz Design | CC-BY-NC-SA-4.0 | Wide-body Pandem kit, not stock GR86 |
| NASCAR Camaro ZL1 | 2022 NASCAR Chevrolet Camaro ZL1 Next Gen — Ddiaz Design | CC-BY-4.0 | Matches |
| Mercedes-AMG F1 W13 | "Mercedec F1 2020" — Kevin Love | CC-BY-4.0 | 2020 car (W11), not W13 (2022) |
| Mazda MX-5 Cup | 2019 Mazda MX-5 — Ddiaz Design | CC-BY-NC-SA-4.0 | 2019 road car, not the Cup car |
| Ferrari 296 GT3 | ferrari_296_gt3 — MattDoesBlender | CC-BY-NC-SA-4.0 | Replacement model supplied on 2026-11-22; matches |

Three licences are NonCommercial (NC): fine for personal use, not for a paid product without the author's permission. CC-BY requires crediting the author.

| Upload / filename stem | Embedded model identity | Author | Licence | Note |
|---|---|---|---|---|
| Daytona_Prototype.glb / daytona-prototype | 2015 Ford-Riley Daytona Prototype | Dave Love SketchFab | CC-BY-4.0 | Matches prototype category |
| LMP1.glb / lmp1 | 2015 Porsche 919 Hybrid LMP1-H | Ddiaz Design | CC-BY-NC-SA-4.0 | Matches LMP1; noncommercial and ShareAlike restrictions apply |
| LMP2.glb / lmp2 | Porsche 963 LMDh Hypercar | kilianhoffmann13 | CC-BY-4.0 | Uploaded label says LMP2, but the actual model is an LMDh Hypercar, not LMP2 |
| Spec_Racer.glb / spec-racer | 2012 HPD ARX-03B | Dave Love SketchFab | CC-BY-4.0 | Uploaded label says Spec Racer, but the actual model is an HPD ARX-03B prototype, not a Spec Racer Ford |

- Source URLs and full licence links are included in each new anchor file. CC-BY requires attribution; the LMP1 model additionally requires noncommercial use and ShareAlike for distributed adaptations.
