// What another simulator calls its tracks and cars, so the Coach page's Simulator Mapping can link them to the site's
// before any lap from them has arrived (laps are refused until the simulator is supported, simulators.ts, and the
// "SimulatorTracks"/"SimulatorCars" rows otherwise only appear as laps do). Ids are the simulator's own, matched
// without regard to case, as the collector sends them. Only a list to pick from: nothing is ever mapped from it
// automatically (simulatorMappings.ts).

export type SimulatorCatalogEntry = { key: string; name: string };
export type SimulatorCatalog = { tracks: SimulatorCatalogEntry[]; cars: SimulatorCatalogEntry[] };

// ACC's static page track id (one layout per circuit). Seen in the game: Spa (2026-11-05). The others are the ids the
// community readers list; a track seen in a lap that isn't here is still listed, from "SimulatorTracks".
const ACC_TRACKS: SimulatorCatalogEntry[] = [
  { key: 'Barcelona', name: 'Circuit de Barcelona-Catalunya' },
  { key: 'brands_hatch', name: 'Brands Hatch Circuit' },
  { key: 'cota', name: 'Circuit of the Americas' },
  { key: 'donington', name: 'Donington Park' },
  { key: 'Hungaroring', name: 'Hungaroring' },
  { key: 'Imola', name: 'Autodromo Enzo e Dino Ferrari (Imola)' },
  { key: 'indianapolis', name: 'Indianapolis Motor Speedway' },
  { key: 'Kyalami', name: 'Kyalami Grand Prix Circuit' },
  { key: 'Laguna_Seca', name: 'WeatherTech Raceway Laguna Seca' },
  { key: 'misano', name: 'Misano World Circuit' },
  { key: 'monza', name: 'Autodromo Nazionale di Monza' },
  { key: 'mount_panorama', name: 'Mount Panorama Circuit (Bathurst)' },
  { key: 'Nurburgring', name: 'Nürburgring (Grand Prix)' },
  { key: 'nurburgring_24h', name: 'Nürburgring 24h (Nordschleife)' },
  { key: 'oulton_park', name: 'Oulton Park' },
  { key: 'Paul_Ricard', name: 'Circuit Paul Ricard' },
  { key: 'Red_Bull_Ring', name: 'Red Bull Ring' },
  { key: 'Silverstone', name: 'Silverstone Circuit' },
  { key: 'snetterton', name: 'Snetterton Circuit' },
  { key: 'Spa', name: 'Circuit de Spa-Francorchamps' },
  { key: 'Suzuka', name: 'Suzuka Circuit' },
  { key: 'Valencia', name: 'Circuit Ricardo Tormo (Valencia)' },
  { key: 'watkins_glen', name: 'Watkins Glen International' },
  { key: 'Zandvoort', name: 'Circuit Zandvoort' },
  { key: 'Zolder', name: 'Circuit Zolder' },
];

// ACC's static page carModel and the name the collector sends for it: collector/RacingCoach.Collector.Core/AccCars.cs,
// which must have the same ids and names (npm run test:simulators checks).
const ACC_CARS: SimulatorCatalogEntry[] = [
  { key: 'amr_v12_vantage_gt3', name: 'Aston Martin Vantage V12 GT3 2013' },
  { key: 'audi_r8_lms', name: 'Audi R8 LMS 2015' },
  { key: 'bentley_continental_gt3_2016', name: 'Bentley Continental GT3 2015' },
  { key: 'bentley_continental_gt3_2018', name: 'Bentley Continental GT3 2018' },
  { key: 'bmw_m6_gt3', name: 'BMW M6 GT3 2017' },
  { key: 'jaguar_g3', name: 'Emil Frey Jaguar G3 2012' },
  { key: 'ferrari_488_gt3', name: 'Ferrari 488 GT3 2018' },
  { key: 'honda_nsx_gt3', name: 'Honda NSX GT3 2017' },
  { key: 'lamborghini_gallardo_rex', name: 'Lamborghini Gallardo G3 Reiter 2017' },
  { key: 'lamborghini_huracan_gt3', name: 'Lamborghini Huracan GT3 2015' },
  { key: 'lamborghini_huracan_st', name: 'Lamborghini Huracan ST 2015' },
  { key: 'lexus_rc_f_gt3', name: 'Lexus RCF GT3 2016' },
  { key: 'mclaren_650s_gt3', name: 'McLaren 650S GT3 2015' },
  { key: 'mercedes_amg_gt3', name: 'Mercedes AMG GT3 2015' },
  { key: 'nissan_gt_r_gt3_2017', name: 'Nissan GTR Nismo GT3 2015' },
  { key: 'nissan_gt_r_gt3_2018', name: 'Nissan GTR Nismo GT3 2018' },
  { key: 'porsche_991_gt3_r', name: 'Porsche 991 GT3 R 2018' },
  { key: 'porsche_991ii_gt3_cup', name: 'Porsche 991 II GT3 Cup 2017' },
  { key: 'amr_v8_vantage_gt3', name: 'Aston Martin V8 Vantage GT3 2019' },
  { key: 'audi_r8_lms_evo', name: 'Audi R8 LMS Evo 2019' },
  { key: 'honda_nsx_gt3_evo', name: 'Honda NSX GT3 Evo 2019' },
  { key: 'lamborghini_huracan_gt3_evo', name: 'Lamborghini Huracan GT3 EVO 2019' },
  { key: 'mclaren_720s_gt3', name: 'McLaren 720S GT3 2019' },
  { key: 'porsche_991ii_gt3_r', name: 'Porsche 911 II GT3 R 2019' },
  { key: 'alpine_a110_gt4', name: 'Alpine A110 GT4 2018' },
  { key: 'amr_v8_vantage_gt4', name: 'Aston Martin Vantage AMR GT4 2018' },
  { key: 'audi_r8_gt4', name: 'Audi R8 LMS GT4 2016' },
  { key: 'bmw_m4_gt4', name: 'BMW M4 GT4 2018' },
  { key: 'chevrolet_camaro_gt4r', name: 'Chevrolet Camaro GT4 R 2017' },
  { key: 'ginetta_g55_gt4', name: 'Ginetta G55 GT4 2012' },
  { key: 'ktm_xbow_gt4', name: 'KTM X-Bow GT4 2016' },
  { key: 'maserati_mc_gt4', name: 'Maserati GranTurismo MC GT4 2016' },
  { key: 'mclaren_570s_gt4', name: 'McLaren 570S GT4 2016' },
  { key: 'mercedes_amg_gt4', name: 'Mercedes AMG GT4 2016' },
  { key: 'porsche_718_cayman_gt4_mr', name: 'Porsche 718 Cayman GT4 MR 2019' },
  { key: 'ferrari_488_gt3_evo', name: 'Ferrari 488 GT3 Evo 2020' },
  { key: 'mercedes_amg_gt3_evo', name: 'Mercedes AMG GT3 Evo 2020' },
  { key: 'bmw_m4_gt3', name: 'BMW M4 GT3 2021' },
  { key: 'audi_r8_lms_evo_ii', name: 'Audi R8 LMS Evo II 2022' },
  { key: 'bmw_m2_cs_racing', name: 'BMW M2 Cup 2020' },
  { key: 'ferrari_488_challenge_evo', name: 'Ferrari 488 Challenge Evo 2020' },
  { key: 'lamborghini_huracan_st_evo2', name: 'Lamborghini Huracan ST Evo2 2021' },
  { key: 'porsche_992_gt3_cup', name: 'Porsche 992 GT3 Cup 2021' },
];

const CATALOGS: Record<string, SimulatorCatalog> = {
  acc: { tracks: ACC_TRACKS, cars: ACC_CARS },
};

export function simulatorCatalog(simulator: string): SimulatorCatalog {
  return CATALOGS[simulator] ?? { tracks: [], cars: [] };
}

// The simulators the Coach page offers mapping for
export const MAPPABLE_SIMULATORS = Object.keys(CATALOGS);
