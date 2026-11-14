const TOKEN = /(\b(?:r1[0-5]|r[0-9]|e?(?:ax|bx|cx|dx|si|di|sp|bp)|[xyz]mm\d+|w\d+|x\d+|lr|sp|pc|xzr|wzr|fp)\b|#?-?0x[0-9a-fA-F]+|#?-?\d+)/g;

export function OperandText({ text }: { text: string }) {
  const parts: { text: string; kind: string }[] = [];
  let cursor = 0;
  for (const match of text.matchAll(TOKEN)) {
    const index = match.index ?? 0;
    if (index > cursor) parts.push({ text: text.slice(cursor, index), kind: 'plain' });
    const token = match[0] ?? '';
    const kind = token.includes('0x') || /^-?\d+$/.test(token) || token.startsWith('#') ? 'imm' : 'reg';
    parts.push({ text: token, kind });
    cursor = index + token.length;
  }
  if (cursor < text.length) parts.push({ text: text.slice(cursor), kind: 'plain' });
  return (
    <>
      {parts.map((part, index) => (
        <span key={index} className={`tok tok-${part.kind}`}>
          {part.text}
        </span>
      ))}
    </>
  );
}
