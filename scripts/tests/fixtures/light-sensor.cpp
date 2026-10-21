#include <cassert>
#include "../../../ESP32/esp32_iot/light_sensor.h"

int main() {
  assert(lightAdcToLux(-1) == 1000);
  assert(lightAdcToLux(0) == 1000);
  assert(lightAdcToLux(2048) == 500);
  assert(lightAdcToLux(4095) == 0);
  assert(lightAdcToLux(5000) == 0);
  int previous = 1000;
  for (int adc = 0; adc <= 4095; ++adc) {
    int lux = lightAdcToLux(adc);
    assert(lux <= previous && lux >= 0 && lux <= 1000);
    assert(lux == ((4095 - adc) * 1000L + 2047) / 4095);
    previous = lux;
  }
}
