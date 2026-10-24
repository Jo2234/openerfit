import type { QlooCallRecord, QlooMode } from '../shared/types';
import type { QlooEnv } from '../server/env';
import type { InsightsParams } from './params';
import { FixtureQlooClient } from './fixture-client';
import { HttpQlooClient } from './http-client';
export type { InsightsParams } from './params';
export interface QlooClient {
  mode: QlooMode;
  search(args:{query:string;types:['urn:entity:artist'];take:number},signal?:AbortSignal):Promise<QlooCallRecord>;
  insights(params:InsightsParams,signal?:AbortSignal):Promise<QlooCallRecord>;
  tags(args:{query:string;take:number},signal?:AbortSignal):Promise<QlooCallRecord>;
}
export function createQlooClient(env: QlooEnv): QlooClient { return env.mode === 'live' ? new HttpQlooClient(env) : new FixtureQlooClient(env.fixtureDir); }
