export function buildAiSalesHistory(messages = []) {
  const history = [];
  for (let index = 0; index < messages.length - 1; index += 1) {
    const userMessage = messages[index];
    const assistantMessage = messages[index + 1];
    if (userMessage?.role !== 'user' || assistantMessage?.role !== 'assistant') continue;
    history.push({
      message: userMessage.answer,
      answer: assistantMessage.answer,
      tool: assistantMessage.tool,
      data: assistantMessage.data,
      context: assistantMessage.context,
    });
  }
  return history;
}
