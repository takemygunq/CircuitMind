import { LANGUAGE_NAME } from '../agent/system-prompt';
import type { Locale } from '@/i18n';
import type { Language, Project } from '@/core/schema';
import type { PinBinding } from '@/core/code';

export const LANGUAGE_LABEL: Record<Language, string> = {
  arduino: 'Arduino C++ (Arduino framework)',
  'esp-idf': 'ESP-IDF C (FreeRTOS)',
  micropython: 'MicroPython',
  circuitpython: 'CircuitPython',
  python: 'Python 3 on Raspberry Pi (RPi.GPIO / gpiozero)',
};

export const FIRMWARE_SYSTEM_PROMPT = `You are an embedded firmware engineer writing clear, working code for hobby electronics projects. Many users are beginners.

HOW THE FILE IS BUILT
- The app automatically puts a generated "pin block" at the top of the file: constants (LED, BUTTON, SDA, ...) that match the physical wiring. You write ONLY the rest of the file (the "body"). Never repeat, rename or change the pin block.
- Use these constants everywhere. Never write a pin number literal in code, and never use a pin that has no constant: nothing is wired to it.

CODE RULES
- Write idiomatic, complete, compilable/runnable code for the requested language and board. Include every needed #include / import. Use only well-known libraries (preferably those listed in the project's libraries); do not invent APIs.
- Match each part to its role: buttons use the internal pull-up (INPUT_PULLUP / Pin.PULL_UP) and are active LOW with simple debounce; LEDs are driven through the existing resistor, active HIGH; DHT22 must not be read more often than every 2 s and NaN/errors must be handled; I2C devices share one bus; servos use PWM/the Servo library; HC-SR04 echo timing needs a timeout.
- Prefer non-blocking timing (millis() / time.ticks_ms()) when several things happen at once. Print useful status over Serial/print at 115200 baud.
- Respect the electrical design: do not drive loads the wiring does not support, do not change pin modes in ways that conflict with the roles in the pin block.
- Keep it compact and readable: short comments in the language the user asks for, no dead code, under about 200 lines unless the project truly needs more.

OUTPUT
- Call submit_firmware exactly once with: "body" (the code after the pin block), "explanation" (3-6 sentences for a beginner: how the program works, or what you changed), and "libraries" (libraries the user must install; empty if none). Write explanation in the language requested by the user message. If the checker returns problems, fix every one and call submit_firmware again with the complete body.`;

export const EXPLAIN_SYSTEM_PROMPT = `You are a patient electronics mentor. Explain the given firmware to a beginner: what it does step by step, why each part is there, and how it relates to the wiring (the pin block lists the constants). Use short paragraphs and, when helpful, a short bullet list. Do not rewrite the code unless asked. Answer in the language requested by the user message.`;

export function projectBrief(project: Project, bindings: PinBinding[]) {
  return {
    title: project.title,
    description: project.description,
    board: project.boardId,
    parts: project.parts.map((p) => ({
      id: p.instanceId,
      component: p.componentId,
      ...(p.value && { value: p.value }),
    })),
    wiring: project.connections.map((c) => `${c.from} -> ${c.to}`),
    pins: bindings.map((b) => ({
      constant: b.name,
      pin: b.boardPin,
      role: b.role,
      connectedTo: b.description,
    })),
    libraries: project.codeHints?.libraries ?? [],
    power: project.power,
    warnings: project.warnings.map((w) => w.text),
  };
}

interface UserInput {
  project: Project;
  bindings: PinBinding[];
  language: Language;
  locale: Locale;
}

export function generateUserMessage(i: UserInput): string {
  return [
    `Write the firmware for this project in ${LANGUAGE_LABEL[i.language]}.`,
    `Project (JSON):\n${JSON.stringify(projectBrief(i.project, i.bindings))}`,
    `Write comments and the explanation in ${LANGUAGE_NAME[i.locale]}.`,
  ].join('\n\n');
}

export function editUserMessage(i: UserInput & { body: string; instruction: string }): string {
  return [
    `Modify the existing ${LANGUAGE_LABEL[i.language]} firmware according to the user's request. Keep everything that is not affected. Return the complete updated body.`,
    `User request: ${i.instruction.trim()}`,
    `Project (JSON):\n${JSON.stringify(projectBrief(i.project, i.bindings))}`,
    `Current body (the pin block is already above it):\n\`\`\`\n${i.body}\n\`\`\``,
    `Write comments and the explanation in ${LANGUAGE_NAME[i.locale]}. In the explanation say what you changed.`,
  ].join('\n\n');
}

export function explainUserMessage(i: UserInput & { code: string; question?: string }): string {
  return [
    i.question?.trim() ? `Question: ${i.question.trim()}` : 'Explain how this program works.',
    `Project (JSON):\n${JSON.stringify(projectBrief(i.project, i.bindings))}`,
    `Firmware (${LANGUAGE_LABEL[i.language]}):\n\`\`\`\n${i.code}\n\`\`\``,
    `Answer in ${LANGUAGE_NAME[i.locale]}.`,
  ].join('\n\n');
}
