import { walk, type Asset, type Conversation, type ExportReport, type ImageNode, type Warning } from '../model';

export function exportReport(conversation: Conversation, assets: ReadonlyMap<ImageNode, Asset>, warnings: readonly Warning[],
  phase: ExportReport['phase'], bytes?: number): ExportReport {
  let blocks = 0, formulas = 0, images = 0, unknown = 0, resolved = 0;
  for (const message of conversation.messages) {
    for (const node of walk(message.blocks)) {
      if (node.kind === 'text') continue;
      blocks++;
      if (node.kind === 'math') formulas++;
      if (node.kind === 'card' && node.type === 'unknown') unknown++;
      if (node.kind === 'image') {
        images++;
        if (assets.get(node)?.blob) resolved++;
      }
    }
  }
  const unique = new Map<string, Warning>();
  const reportedWarnings = [...conversation.warnings, ...warnings];
  const integrityWarnings: Warning[] = [];
  for (const message of conversation.messages) {
    if (!message.blocks.length) integrityWarnings.push({ code: 'empty-message', message: message.index });
    for (const node of walk(message.blocks)) {
      if (node.kind === 'card' && node.type === 'unknown')
        integrityWarnings.push({ code: 'unknown-component', detail: node.label, message: message.index });
    }
    if (message.status === 'partial' && !reportedWarnings.some(warning => warning.message === message.index) &&
      !integrityWarnings.some(warning => warning.message === message.index))
      integrityWarnings.push({ code: 'message-partial', message: message.index });
  }
  for (const warning of [...reportedWarnings, ...integrityWarnings]) unique.set(JSON.stringify(warning), warning);
  const state = phase === 'failed' ? 'Failed' : unique.size || conversation.requested !== conversation.messages.length ||
    images !== resolved || conversation.messages.some(message => message.status === 'partial') ? 'Partial' : 'Complete';
  return { state, phase, detected: conversation.detected, selected: conversation.requested,
    parsed: conversation.messages.filter(message => message.blocks.length).length, blocks, formulas, images, resolved, unknown, bytes,
    warnings: [...unique.values()] };
}
