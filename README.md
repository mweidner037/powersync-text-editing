# PowerSync Text Editing Demo

## Overview

Demo app using the [PowerSync SDK for Web](https://www.npmjs.com/package/@powersync/web) for **collaborative text-editing**. Built with [Tiptap](https://tiptap.dev/) and [Supabase](https://supabase.com/).

The demo stores each update to the text document as a row in a PowerSync table. Instead of using Yjs or a similar collaboration library, the updates are stored as "steps" describing what the user originally did - specifically, [ProseMirror steps](https://prosemirror.net/docs/guide/#transform.steps) but with their positions replaced by immutable character IDs. The app computes the current text state by replaying the steps in (the server's) order. Thanks to the character IDs, that gives a reasonable result even if users edit the text concurrently.

You can learn more about this text-editing strategy in the blog post [Collaborative Text Editing without CRDTs or OT](https://mattweidner.com/2025/05/21/text-without-crdts.html). This demo stores character IDs using the [Articulated](https://github.com/mweidner037/articulated) library described there.

### Why?

Why implement the demo using ProseMirror steps + character IDs instead of a more traditional CRDT library?

- Transparency: You can "see" what the updates are doing, at least if you have a good understanding of [ProseMirror's step types](https://prosemirror.net/docs/ref/#transform.Steps).
- Flexibility: You control how updates are generated and applied, so you can tweak how they interact with conflicting updates, or generalize them to more complex data structures.
- Guaranteed Convergence: All users eventually see the same updates applied in the same order, so they're guaranteed to see the same result even if you mess up your update-processing function - you don't need to satisfy algebraic rules like with CRDTs or Operational Transformation. (Though bad update processing might leave users in a consistently-corrupted state...)

Why PowerSync?

- The PowerSync client manages reconnections to the backend for you, gracefully handling duplicate data transfers. (Try doing this with plain WebSockets...)
- Built-in cross-tab collaboration.
- Local persistent storage, including offline mode.

> In our experience, the above features are **harder** than collaborative text editing, in spite of all the ink spilled about CRDTs and Operational Transformation.

Why else did we make this demo?

- Stress-test PowerSync with high-volume, low latency updates (a new row per keypress).
- Explore PowerSync's support for common collaborative document features, such as shared presence and public share links.
- Make the above [blog post](https://mattweidner.com/2025/05/21/text-without-crdts.html) real!

## Getting Started

First, setup PowerSync and Supabase following the guide [here](https://docs.powersync.com/integration-guides/supabase-+-powersync).

Next, use [pnpm](https://pnpm.io/installation) to install dependencies:

```bash
pnpm install
```

Set up the Environment variables: Copy the `.env.local.template` file:

```bash
cp .env.local.template .env.local
```

And then edit `.env.local` to insert your credentials for Supabase.

Run the development server:

```bash
pnpm dev
```

Open [http://localhost:5173](http://localhost:5173) with your browser to see the result.

## Progressive Web App (PWA)

This demo is PWA compatible, and works fully offline. PWA is not available in development (watch) mode. The manifest and service worker is built using [vite-plugin-pwa](https://vite-pwa-org.netlify.app/).

Build the production codebase:

```bash
pnpm build
```

Run the production server:

```bash
pnpm preview
```

Open a browser on the served URL and install the PWA.

## Learn More

Check out [the PowerSync Web SDK on GitHub](https://github.com/powersync-ja/powersync-js/tree/main/packages/web) - your feedback and contributions are welcome!

To learn more about PowerSync, see the [PowerSync docs](https://docs.powersync.com).
