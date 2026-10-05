// Печатает значение A0 каждые 100 мс
void setup() { Serial.begin(9600); }
void loop() { Serial.println(analogRead(A0)); delay(100); }
