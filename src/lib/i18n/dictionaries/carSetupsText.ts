// The Setups page's iRacing Setups tab (src/components/SetupCarLibrary.tsx; docs/setups.md's iRacing setup collection),
// in English: setups.carSetups of the dictionaries (setupsText.ts takes it). Each language's translation
// (carSetupsTextPt.ts ...) must have exactly its shape, {placeholders} included.

export const carSetupsEn = {
  intro:
    'iRacing setup files copied from the sim PC by the telemetry collector’s Get Car Setups, kept byte for byte. For Admins only until the licensing and redistribution of iRacing’s setups is decided.',
  car: 'Car',
  noCars: 'No setups imported yet. Press Get Car Setups in the telemetry collector on the sim PC.',
  noSetups: 'This car has no imported setups.',
  columns: {
    setup: 'Setup',
    sto: 'STO',
    htm: 'HTM',
    imported: 'Imported',
    origin: 'Origin',
    actions: 'Actions',
  },
  available: 'Available',
  notAvailable: 'Not available',
  htmStatus: {
    parsed: 'Values read',
    empty: 'No values found',
    failed: 'Couldn’t be read',
    missing: 'No .htm export',
  },
  view: 'View',
  hide: 'Hide',
  downloadSto: 'Download STO',
  downloadHtm: 'Download HTM',
  version: 'Version {version}',
  provenance: {
    official: 'Official iRacing setup',
    user: 'User-created',
    unknown: 'Unknown origin',
  },
  provenanceHelp: 'Nothing in the files says who made a setup. Mark it official only once you’ve checked it’s one of iRacing’s own.',
  details: {
    title: '{name}: values from the .htm export',
    unavailable: 'Detailed settings are unavailable: this setup has no .htm export. The .sto file is still kept and can be downloaded.',
    failed: 'Detailed settings are unavailable: the .htm export couldn’t be read.',
    empty: 'The .htm export has no setup values.',
    box: 'Box',
    setting: 'Setting',
    value: 'Value',
    reading: 'Reading',
    readingHelp: 'Measured or worked out by iRacing',
    inCar: 'In-car',
    exportCar: 'Car in the export',
    exportTrack: 'Track in the export',
    boxNotes: 'Notes in the export',
    setupNotes: 'Setup notes',
    warnings: 'Lines the parser couldn’t read',
    files: 'Files',
    sha: 'SHA-256',
    bytes: '{bytes} bytes',
  },
  imports: {
    title: 'Recent imports',
    status: {
      running: 'Running',
      complete: 'Complete',
      completeWithErrors: 'Complete with failures',
      failed: 'Failed',
    },
    counts: '{found} found · {new} new · {changed} changed · {unchanged} unchanged · {failed} failed',
    unresolved: 'Not imported, as these folders aren’t a Car Data car: {folders}',
    failures: 'Failures',
  },
  loadFailed: 'The iRacing setups couldn’t be loaded.',
  saveFailed: 'That couldn’t be saved. Try again.',
};

export type CarSetupsText = typeof carSetupsEn;
