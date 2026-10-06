import { FilesetResolver, HandLandmarker, PoseLandmarker } from '@mediapipe/tasks-vision';
import type { Landmark, NormalizedLandmark } from '@mediapipe/tasks-vision';
import type { HandFrame, PoseFrame, RawFrame, V3 } from '../types';

const VERSION = '1.0.1';
const CDN_WASM = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${VERSION}/wasm`;
const MODEL_BASE = 'https://storage.googleapis.com/mediapipe-models';
const REMOTE_MODELS = {
  lite: `${MODEL_BASE}/pose_landmarker/pose_landmarker_lite/float16/latest/pose_landmarker_lite.task`,
  full: `${MODEL_BASE}/pose_landmarker/pose_landmarker_full/float16/latest/pose_landmarker_full.task`,
  heavy: `${MODEL_BASE}/pose_landmarker/pose_landmarker_heavy/float16/latest/pose_landmarker_heavy.task`,
  hand: `${MODEL_BASE}/hand_landmarker/hand_landmarker/float16/latest/hand_landmarker.task`,
};

export type PoseModel = 'lite' | 'full' | 'heavy';

export interface Detector {
  detect(video: HTMLVideoElement, timestampMs: number): RawFrame;
  readonly hands: boolean;
  readonly delegate: 'GPU' | 'CPU';
}

/** Prefer a locally served copy (see `npm run fetch-models`), else the public CDN. */
async function localOr(localPath: string, remote: string): Promise<string> {
  const url = `${import.meta.env.BASE_URL}${localPath}`;
  try {
    const res = await fetch(url, { method: 'HEAD' });
    const type = res.headers.get('content-type') ?? '';
    if (res.ok && !type.includes('text/html')) return url;
  } catch {
    /* fall through to remote */
  }
  return remote;
}

// Display is mirrored (selfie view), so flip x for both image and world coordinates.
const mirrorImage = (l: NormalizedLandmark): V3 => ({ x: 1 - l.x, y: l.y, z: l.z });
const mirrorWorld = (l: Landmark): V3 => ({ x: -l.x, y: l.y, z: l.z });

export async function createDetector(opts: {
  model: PoseModel;
  hands: boolean;
  onStatus: (msg: string) => void;
}): Promise<Detector> {
  opts.onStatus('Loading vision runtime…');
  const wasmBase = await localOr('mediapipe/wasm/vision_wasm_internal.js', '').then((u) =>
    u ? u.replace(/\/vision_wasm_internal\.js$/, '') : CDN_WASM,
  );
  const fileset = await FilesetResolver.forVisionTasks(wasmBase);

  const poseUrl = await localOr(`models/pose_landmarker_${opts.model}.task`, REMOTE_MODELS[opts.model]);
  const handUrl = opts.hands ? await localOr('models/hand_landmarker.task', REMOTE_MODELS.hand) : null;

  let delegate: 'GPU' | 'CPU' = 'GPU';
  const makePose = (d: 'GPU' | 'CPU') =>
    PoseLandmarker.createFromOptions(fileset, {
      baseOptions: { modelAssetPath: poseUrl, delegate: d },
      runningMode: 'VIDEO',
      numPoses: 2,
      minPoseDetectionConfidence: 0.5,
      minPosePresenceConfidence: 0.5,
      minTrackingConfidence: 0.5,
    });
  const makeHand = (d: 'GPU' | 'CPU') =>
    HandLandmarker.createFromOptions(fileset, {
      baseOptions: { modelAssetPath: handUrl!, delegate: d },
      runningMode: 'VIDEO',
      numHands: 4,
      minHandDetectionConfidence: 0.5,
      minHandPresenceConfidence: 0.5,
      minTrackingConfidence: 0.5,
    });

  opts.onStatus(`Loading pose model (${opts.model})…`);
  let pose: PoseLandmarker;
  try {
    pose = await makePose('GPU');
  } catch (err) {
    console.warn('GPU delegate failed, falling back to CPU', err);
    delegate = 'CPU';
    pose = await makePose('CPU');
  }

  let hand: HandLandmarker | null = null;
  if (handUrl) {
    opts.onStatus('Loading hand model…');
    try {
      hand = await makeHand(delegate);
    } catch (err) {
      console.warn('Hand landmarker unavailable, continuing with pose only', err);
    }
  }

  let lastTs = -1;
  return {
    hands: hand !== null,
    delegate,
    detect(video, timestampMs) {
      const ts = Math.max(timestampMs, lastTs + 1);
      lastTs = ts;
      const pr = pose.detectForVideo(video, ts);
      const poses: PoseFrame[] = pr.landmarks.map((lm, i) => ({
        image: lm.map(mirrorImage),
        world: (pr.worldLandmarks[i] ?? []).map(mirrorWorld),
        vis: lm.map((l) => l.visibility ?? 1),
      }));
      const hands: HandFrame[] = [];
      if (hand) {
        const hr = hand.detectForVideo(video, ts);
        hr.landmarks.forEach((lm, i) => {
          hands.push({
            image: lm.map(mirrorImage),
            world: (hr.worldLandmarks[i] ?? []).map(mirrorWorld),
            score: hr.handedness[i]?.[0]?.score ?? 1,
          });
        });
      }
      return { poses: poses.filter((p) => p.world.length > 0), hands };
    },
  };
}
