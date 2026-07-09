function safeId(pvName) {
  return pvName.replace(/[^a-zA-Z0-9\-_]/g, '_');
}

function hashColor(name) {
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash);
  }
  const hue = hash % 360;
  return `hsl(${hue}, 60%, 75%)`;
}
