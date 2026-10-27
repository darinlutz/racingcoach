// Pictures of the default cars in public/assets/carPics, each named after the car (lowercase, words joined with
// dashes: "Porsche 911 GT3 R (992)" is porsche-911-gt3-r-992.jpg). All 992 x 672.
const CAR_PICTURES = new Set([
  'acura-nsx-gt3-evo-22',
  'aston-martin-vantage-gt3-evo',
  'audi-r8-lms-evo-ii-gt3',
  'bmw-m4-gt3-evo',
  'chevrolet-corvette-z06-gt3-r',
  'dallara-p217-lmp2',
  'ferrari-296-gt3',
  'ford-mustang-gt3',
  'global-mazda-mx-5-cup',
  'lamborghini-huracan-gt3-evo',
  'legends-ford-34-coupe',
  'mclaren-720s-gt3-evo',
  'mercedes-amg-f1-w12-e-performance',
  'mercedes-amg-gt3-2020',
  'next-gen-nascar-cup-series-chevrolet-camaro-zl1',
  'porsche-911-gt3-r-992',
  'porsche-963-gtp',
  'toyota-gr86',
]);

export const CAR_PICTURE_WIDTH = 360;
export const CAR_PICTURE_HEIGHT = Math.round((CAR_PICTURE_WIDTH * 672) / 992);

const slug = (name: string) => name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

// The picture of a car by its name, or null for a car without one (e.g. one a user added)
export function carPictureUrl(name: string): string | null {
  const key = slug(name);
  return CAR_PICTURES.has(key) ? `/assets/carPics/${key}.jpg` : null;
}
