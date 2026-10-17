// Presentation-only archive validation. Delivery order is never causal order.
export function assessArchivePage(page) {
  if (!page || !Array.isArray(page.records) || page.records.length > 500) throw new TypeError('Invalid bounded archive page');
  let previous = null;
  const records = page.records.map(record => {
    if (!record || typeof record !== 'object' || typeof record.capture_session_id !== 'string' || !record.capture_session_id ||
      !Number.isSafeInteger(record.delivery_sequence) || record.delivery_sequence < 0) throw new TypeError('Invalid archive record');
    const key = record.capture_session_id;
    const sequence = record.delivery_sequence;
    let continuity = 'unknown';
    if (previous && previous.key === key) {
      continuity = sequence === previous.sequence + 1 ? 'adjacent-delivery' :
        sequence > previous.sequence + 1 ? 'delivery-gap' : 'duplicate-or-out-of-order';
    }
    previous = {key,sequence};
    return Object.freeze({captureSessionId:key,deliverySequence:sequence,continuity,causalTick:null});
  });
  return Object.freeze({records,completeCausalHistory:false,readOnly:true});
}
