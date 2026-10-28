import {
  createPageScriptChannel,
  type CreatePageScriptChannelOptions,
} from "devframe/in-page-channel";

import { RuntimeController } from "./controller";
import { CHANNEL_NAME, PROTOCOL_VERSION, type JotaiChannelProtocol } from "./protocol";

export function createRuntimeChannel(
  controller: RuntimeController,
  windowOption?: CreatePageScriptChannelOptions<JotaiChannelProtocol>["window"],
) {
  const channel = createPageScriptChannel<JotaiChannelProtocol>({
    name: CHANNEL_NAME,
    window: windowOption,
    functions: {
      getInfo: {
        jsonSerializable: true,
        handler: () => ({ protocolVersion: PROTOCOL_VERSION, sessionId: controller.sessionId }),
      },
      getAtom: { jsonSerializable: true, handler: (input) => controller.getAtom(input) },
      getSnapshot: { jsonSerializable: true, handler: (input) => controller.getSnapshot(input) },
      setRecording: { type: "action", handler: (input) => controller.setRecording(input) },
      clearHistory: { type: "action", handler: (input) => controller.clearHistory(input) },
      restoreSnapshot: { type: "action", handler: (input) => controller.restoreSnapshot(input) },
      setPlayback: { type: "action", handler: (input) => controller.setPlayback(input) },
    },
  });
  const shared = channel.sharedState.get("runtime", { initialValue: controller.getState() });
  const unsubscribe = controller.subscribe((value) => {
    void shared.then((state) =>
      state.mutate((draft) => {
        draft.sessionId = value.sessionId;
        draft.protocolVersion = value.protocolVersion;
        draft.stores = value.stores;
      }),
    );
  });
  channel.events.on("panel:connected", () => controller.setPanelCount(channel.panels.length));
  channel.events.on("panel:disconnected", () => controller.setPanelCount(channel.panels.length));
  return {
    channel,
    close() {
      unsubscribe();
      controller.setPanelCount(0);
      channel.close();
    },
  };
}
