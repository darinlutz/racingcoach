import config from '../../rotation-model/config.json';
import calibrations from '../../rotation-model/calibrations.json';
import { findCalibration, type RotationCalibration, type RotationModelConfig } from './rotationModel.ts';

// The Rotation Model's shared settings and car calibrations (rotation-model/), the same files the collector
// builds in. Kept apart from rotationModel.ts so that file has no imports and Node can run it directly.

export const ROTATION_MODEL_CONFIG = config as RotationModelConfig;
export const ROTATION_CALIBRATIONS = (calibrations as { calibrations: RotationCalibration[] }).calibrations;

// The calibration for a car by its iRacing screen name (CollectorLaps.car), or null
export function calibrationForCar(car: string): RotationCalibration | null {
  return findCalibration(ROTATION_CALIBRATIONS, { carName: car });
}
