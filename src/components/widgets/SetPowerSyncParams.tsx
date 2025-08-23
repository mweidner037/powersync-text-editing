import { usePowerSync } from '@powersync/react';
import {
  AbstractPowerSyncDatabase,
  PowerSyncBackendConnector,
  StreamingSyncRequestParameterType
} from '@powersync/web';
import { ReactNode } from 'react';
import _ from 'lodash';

// State for SetPowerSyncParams.
// Normally these would be refs, but for some reason, React is not preserving
// refs across re-renders (apparently a Suspense thing).
const perComponentState = new WeakMap<
  AbstractPowerSyncDatabase,
  {
    // The params in use by powerSync.
    activeParams: Record<string, any> | null;
    // The promise we're waiting on.
    promise: Promise<void> | null;
    // The most recent params prop, used to keep the promise informed.
    propParams: Record<string, any> | null;
  }
>();

export type SetPowerSyncParamsProps = {
  connector: PowerSyncBackendConnector;
  params: Record<string, StreamingSyncRequestParameterType>;
  children: ReactNode;
};

/**
 * A component that sets the [Client Parameters](https://docs.powersync.com/usage/sync-rules/advanced-topics/client-parameters)
 * in PowerSync's connection options.
 *
 * The component suspends until PowerSync has reconnected with these parameters,
 * afterwards rendering the children.
 */
export const SetPowerSyncParams = ({ connector, params, children }: SetPowerSyncParamsProps) => {
  const powerSync = usePowerSync();

  let state = perComponentState.get(powerSync);
  if (!state) {
    state = { activeParams: null, propParams: null, promise: null };
    perComponentState.set(powerSync, state);
  }

  if (_.isEqual(params, state.activeParams)) {
    return children;
  }

  if (state.promise === null || !_.isEqual(params, state.propParams)) {
    state.propParams = params;
    state.promise = (async () => {
      await powerSync.disconnect();
      if (!_.isEqual(params, state.propParams)) {
        // Component re-rendered with new params before we finished. Stop.
        return;
      }
      // TODO: Allow passing other options here.
      await powerSync.connect(connector, { params });
      state.activeParams = params;
    })();
  }

  throw state.promise;
};
