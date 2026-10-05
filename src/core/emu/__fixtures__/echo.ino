// Эхо Serial в верхнем регистре
void setup() { Serial.begin(9600); Serial.println("ready"); }
void loop() { if (Serial.available()) { int c = Serial.read(); Serial.write(toupper(c)); } }
