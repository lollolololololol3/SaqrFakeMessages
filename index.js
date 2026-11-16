(function () {
  const V = vendetta;
  const React = V.metro.common.React;
  const RN = V.metro.common.ReactNative;
  const storage = V.plugin.storage;
  const useProxy = V.storage.useProxy;
  const before = V.patcher.before;
  const findByStoreName = V.metro.findByStoreName;
  const showToast = V.ui.toasts.showToast;
  const { View, Text, TextInput, Pressable, ScrollView } = RN;

  storage.messages ??= [];
  let unpatch = null;

  function currentChannelId() {
    try {
      const selected = findByStoreName("SelectedChannelStore");
      return selected?.getChannelId?.() ??
        selected?.getLastSelectedChannelId?.() ?? null;
    } catch (_) { return null; }
  }

  function installChatPatch() {
    const manager = RN.NativeModules?.DCDChatManager;
    if (!manager?.updateRows) {
      showToast("Saqr Fake Messages: this Discord build's chat hook was not found.", undefined);
      return null;
    }

    return before("updateRows", manager, (args) => {
      try {
        if (typeof args?.[1] !== "string") return;
        const rows = JSON.parse(args[1]);
        if (!Array.isArray(rows)) return;

        const channelId = currentChannelId() ??
          rows.find(r => r?.rowType === 1 && r?.message?.channelId)?.message?.channelId;
        if (!channelId) return;

        const seed = rows.find(r =>
          r?.rowType === 1 &&
          r?.message &&
          r.message.channelId === channelId &&
          !String(r.message.id ?? "").startsWith("saqr-local-")
        );
        if (!seed) return;

        const local = (storage.messages ?? []).filter(m => m.channelId === channelId);
        if (!local.length) return;

        const nextRows = rows.filter(r =>
          !String(r?.message?.id ?? "").startsWith("saqr-local-")
        );

        for (const fake of local) {
          const row = JSON.parse(JSON.stringify(seed));
          const message = row.message;
          message.id = fake.id;
          message.channelId = channelId;
          message.content = [{
            type: "text",
            content: "[LOCAL PREVIEW] " + fake.content
          }];
          message.timestamp = new Date(fake.createdAt).toISOString();
          message.editedTimestamp = null;
          message.nonce = fake.id;
          message.attachments = [];
          message.embeds = [];
          message.referencedMessage = null;

          // Only use an account already cached by Discord. No arbitrary avatar/name spoofing.
          if (fake.authorId) {
            try {
              const users = findByStoreName("UserStore");
              if (users?.getUser?.(fake.authorId)) message.authorId = fake.authorId;
            } catch (_) {}
          }

          nextRows.push(row);
        }

        args[1] = JSON.stringify(nextRows);
      } catch (_) {
        // If the app's row structure changes, preserve the real chat unchanged.
      }
    });
  }

  function Settings() {
    useProxy(storage);
    const [content, setContent] = React.useState("");
    const [authorId, setAuthorId] = React.useState("");

    const field = (value, onChangeText, placeholder, multiline) =>
      React.createElement(TextInput, {
        value, onChangeText, placeholder, multiline: !!multiline,
        placeholderTextColor: "#999",
        style: {
          color: "#fff", backgroundColor: "#2b2d31", borderRadius: 9,
          padding: 12, marginTop: 10, minHeight: multiline ? 90 : 46,
          textAlignVertical: multiline ? "top" : "center"
        }
      });

    const button = (label, onPress, color = "#5865F2") =>
      React.createElement(Pressable, {
        onPress,
        style: {
          backgroundColor: color, padding: 13, borderRadius: 9,
          marginTop: 10, alignItems: "center"
        }
      }, React.createElement(Text, { style: { color: "#fff", fontWeight: "700" } }, label));

    const add = () => {
      const text = content.trim();
      const channelId = currentChannelId();
      if (!text) return showToast("Write a preview message first.", undefined);
      if (!channelId) return showToast("Open a chat first.", undefined);

      storage.messages = [...(storage.messages ?? []), {
        id: "saqr-local-" + Date.now() + "-" + Math.random().toString(36).slice(2, 7),
        channelId,
        authorId: authorId.trim(),
        content: text,
        createdAt: Date.now()
      }];
      setContent("");
      showToast("Local preview added. It is not sent to Discord.", undefined);
    };

    const clear = () => {
      storage.messages = [];
      showToast("Local previews cleared.", undefined);
    };

    return React.createElement(ScrollView, {
      style: { padding: 16 }, keyboardShouldPersistTaps: "handled"
    },
      React.createElement(Text, {
        style: { color: "#fff", fontSize: 19, fontWeight: "700" }
      }, "Saqr Fake Messages"),
      React.createElement(Text, {
        style: { color: "#b5bac1", marginTop: 6 }
      }, "Local-only preview. Every inserted row is marked LOCAL PREVIEW and is never sent."),
      field(authorId, setAuthorId, "Optional cached Discord user ID", false),
      field(content, setContent, "Write your local preview…", true),
      button("Add to the open chat", add),
      button("Clear local previews (" + (storage.messages?.length ?? 0) + ")", clear, "#4e5058")
    );
  }

  return {
    onLoad() {
      storage.messages ??= [];
      unpatch = installChatPatch();
    },
    onUnload() {
      try { unpatch?.(); } catch (_) {}
      unpatch = null;
    },
    settings: Settings
  };
})()
