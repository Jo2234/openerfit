import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { parseEnv } from './env';
import { createApp } from './app';
import { createQlooClient } from '../qloo/client';
import { createApplicationServices } from '../agent/services';
const env=parseEnv();
const {app,runs}=createApp({env,gitSha:process.env.GIT_SHA||process.env.RENDER_GIT_COMMIT,client:createQlooClient(env.qloo),services:createApplicationServices(env)});
if(env.production){app.use('/*',serveStatic({root:'dist/web'}));app.get('*',serveStatic({path:'dist/web/index.html'}));}
const server=serve({fetch:app.fetch,hostname:env.host,port:env.port});
const shutdown=()=>{runs.close();server.close();};
process.once('SIGINT',shutdown);process.once('SIGTERM',shutdown);
