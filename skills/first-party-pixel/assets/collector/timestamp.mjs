// Collector storage policy: real ISO calendar, 0001..9999 both lexically and UTC.
// PostgreSQL stores a floored microsecond projection; original nanoseconds survive.
export function parseCollectorTimestamp(value) {
  const invalid = () => { throw new TypeError('occurred_at must be a valid calendar ISO timestamp within UTC years 0001..9999, with Z or offset through 14:00'); };
  const match = typeof value === 'string' && /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,9}))?(Z|[+-]\d{2}:\d{2})$/.exec(value);
  if (!match || match[0] !== value) return invalid();
  const [year,month,day,hour,minute,second] = match.slice(1,7).map(Number);
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31,leap ? 29 : 28,31,30,31,30,31,31,30,31,30,31];
  const zone = match[8], offsetHour = zone === 'Z' ? 0 : Number(zone.slice(1,3)), offsetMinute = zone === 'Z' ? 0 : Number(zone.slice(4));
  if (year < 1 || month < 1 || month > 12 || day < 1 || day > days[month-1] || hour > 23 || minute > 59 || second > 59 || offsetHour > 14 || offsetMinute > 59 || (offsetHour === 14 && offsetMinute !== 0)) return invalid();
  const epochMs = Date.parse(`${match[1]}-${match[2]}-${match[3]}T${match[4]}:${match[5]}:${match[6]}${zone}`);
  if (!Number.isFinite(epochMs) || epochMs < -62135596800000 || epochMs > 253402300799000) return invalid();
  const fraction = (match[7] || '').padEnd(9,'0');
  return { original: value, postgres: `${new Date(epochMs).toISOString().slice(0,19)}.${fraction.slice(0,6)}Z` };
}
