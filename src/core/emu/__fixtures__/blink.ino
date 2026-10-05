// Мигает D13 раз в 500 мс и печатает счётчик
unsigned long n = 0;
void setup() { pinMode(13, OUTPUT); Serial.begin(9600); }
void loop() {
  digitalWrite(13, HIGH); delay(500);
  digitalWrite(13, LOW);  delay(500);
  Serial.print("tick "); Serial.println(n++);
}
