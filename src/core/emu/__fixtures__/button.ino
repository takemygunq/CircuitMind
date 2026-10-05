// D13 повторяет кнопку на D2 (INPUT_PULLUP, нажатие = LOW)
void setup() { pinMode(2, INPUT_PULLUP); pinMode(13, OUTPUT); }
void loop() { digitalWrite(13, digitalRead(2) == LOW ? HIGH : LOW); }
