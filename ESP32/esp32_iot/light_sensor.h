#pragma once

constexpr int LIGHT_ADC_BITS = 12;
constexpr int LIGHT_ADC_MAX = (1 << LIGHT_ADC_BITS) - 1;
constexpr int LIGHT_MAX_LUX = 1000;

// This LDR circuit produces lower ADC readings in brighter light.
// Linear estimate for this project's display scale; calibrate against a lux meter
// before treating the result as a physical illuminance measurement.
inline int lightAdcToLux(int adc) {
  if (adc <= 0) return LIGHT_MAX_LUX;
  if (adc >= LIGHT_ADC_MAX) return 0;
  return (static_cast<long>(LIGHT_ADC_MAX - adc) * LIGHT_MAX_LUX + LIGHT_ADC_MAX / 2) / LIGHT_ADC_MAX;
}
