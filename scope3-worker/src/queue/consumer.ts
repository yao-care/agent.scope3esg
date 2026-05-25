import { executePullJob } from '../handlers/pull-job';
import type { Bindings, PullJobMessage } from '../types';

export async function handleQueue(
  batch: MessageBatch<PullJobMessage>,
  env: Bindings,
  _ctx: ExecutionContext,
): Promise<void> {
  for (const msg of batch.messages) {
    try {
      await executePullJob(env, msg.body);
      msg.ack();
    } catch (err) {
      console.error('[queue] job failed:', err);
      msg.retry();
    }
  }
}
