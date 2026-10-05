/** Включает клиент без сети для разработки и демо (CIRCUITMIND_MOCK_AI=1). */
export const isMockAi = () => process.env.CIRCUITMIND_MOCK_AI === '1';
