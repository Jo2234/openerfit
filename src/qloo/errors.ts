export class QlooError extends Error {
  constructor(public code: string, message: string, public httpStatus: number) { super(message); this.name = 'QlooError'; }
}
export function upstreamError(status: number): QlooError {
  const codes: Record<number,string> = {400:'qloo_bad_request',401:'qloo_auth',403:'qloo_forbidden_type',404:'qloo_not_found',429:'qloo_rate_limited'};
  return new QlooError(codes[status] ?? 'qloo_unavailable', 'Qloo request failed. No upstream body or credentials are exposed.', [400,401,403,404].includes(status) ? 502 : 503);
}
