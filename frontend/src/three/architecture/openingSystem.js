// ---------------------------------------------------------------------------
// openingSystem.js
//
// Doors and windows are never placed in free space — every opening's world
// transform is derived here from its parent wall's start/end/thickness plus
// the opening's offsetAlongWall/sillHeight, so it is geometrically
// impossible for a window to float outside its wall.
//
// Returns, for a given (wall, opening) pair:
//   - cutSize / cutCenter: the box to CSG-subtract from the wall solid
//   - fillGroup: THREE.Group with the frame, glazing/door slab, sill,
//     mullions/transoms (windows) or frame/slab/threshold/handle (doors)
// ---------------------------------------------------------------------------
import * as THREE from 'three';
import { wallAngle, wallLength, pointAlongWall } from './buildingModel.js';
import { glazingMaterial, frameMaterial, doorMaterial } from './materialSystem.js';

export function openingWorldTransform(wall, opening) {
  const len = wallLength(wall);
  const clampedOffset = Math.min(Math.max(opening.offsetAlongWall, opening.width / 2 + 0.05), Math.max(len - opening.width / 2 - 0.05, opening.width / 2 + 0.05));
  const [cx, cz] = pointAlongWall(wall, clampedOffset);
  const centerY = wall.baseElevation + opening.sillHeight + opening.height / 2;
  const rotY = wallAngle(wall);
  return { position: [cx, centerY, cz], rotY, clampedOffset };
}

export function buildOpeningCut(wall, opening) {
  const { position, rotY } = openingWorldTransform(wall, opening);
  // Cut slightly proud of the wall face on both sides so CSG subtraction
  // always fully punches through regardless of thickness rounding.
  const cutDepth = wall.thickness * 4;
  return { position, rotY, size: [opening.width, opening.height, cutDepth] };
}

export function buildOpeningFill(wall, opening) {
  const { position, rotY } = openingWorldTransform(wall, opening);
  const group = new THREE.Group();
  group.position.set(position[0], position[1], position[2]);
  group.rotation.y = rotY;
  group.userData.group = opening.type === 'window' ? 'window' : 'door';
  group.userData.openingId = opening.id;
  group.userData.room = opening.room;
  group.userData.material = opening.type === 'window' ? 'glazing' : opening.type;

  const w = opening.width, h = opening.height, wallT = wall.thickness;
  const frameDepth = Math.max(wallT * 0.9, 0.06);
  const frameThk = 0.06;

  if (opening.type === 'window') {
    buildWindow(group, w, h, wallT, frameThk, frameDepth, opening);
  } else {
    buildDoor(group, w, h, wallT, frameDepth, opening);
  }
  // Tag every leaf mesh (frame bars, glazing, slab, handle, sill...) with
  // the same group label as the opening itself, so the viewer's per-group
  // recolor swatches and "show interior" roof toggle — which key off each
  // individual mesh's userData.group — apply consistently across the whole
  // opening, not just its parent Group.
  const label = group.userData.group;
  group.traverse((obj) => { if (obj.isMesh && !obj.userData.group) obj.userData.group = label; });
  return group;
}

function buildWindow(group, w, h, wallT, frameThk, frameDepth, opening) {
  const frameMat = frameMaterial(opening.style === 'wood-frame' ? 'wood' : 'aluminium', opening.color);
  const glassMat = glazingMaterial();

  // Outer frame (four bars forming a rectangle border)
  const bar = (bw, bh, x, y) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(bw, bh, frameDepth), frameMat);
    m.position.set(x, y, 0);
    m.castShadow = true; m.receiveShadow = true;
    return m;
  };
  group.add(bar(w, frameThk, 0, h / 2 - frameThk / 2)); // top
  group.add(bar(w, frameThk, 0, -h / 2 + frameThk / 2)); // bottom
  group.add(bar(frameThk, h, -w / 2 + frameThk / 2, 0)); // left
  group.add(bar(frameThk, h, w / 2 - frameThk / 2, 0)); // right

  // Glazing pane(s)
  const glassW = w - frameThk * 2, glassH = h - frameThk * 2;
  const glass = new THREE.Mesh(new THREE.BoxGeometry(Math.max(glassW, 0.05), Math.max(glassH, 0.05), frameDepth * 0.3), glassMat);
  glass.position.set(0, 0, 0);
  group.add(glass);

  // Mullions — a vertical + horizontal bar for wider windows, giving real
  // panes instead of one undivided sheet of glass.
  if (opening.mullions !== false && w > 1.1) {
    const vCount = w > 2.2 ? 2 : 1;
    for (let i = 1; i <= vCount; i++) {
      const x = -glassW / 2 + (glassW * i) / (vCount + 1);
      group.add(bar(0.035, glassH, x, 0));
    }
  }
  if (opening.mullions !== false && h > 1.3) {
    group.add(bar(glassW, 0.035, 0, 0));
  }

  // Sill — projects outward (toward -Z local, i.e. exterior face) below the
  // opening, standard architectural detail.
  const sill = new THREE.Mesh(new THREE.BoxGeometry(w + 0.12, 0.06, wallT + 0.14), frameMaterial('stone', '#d8d3c6'));
  sill.position.set(0, -h / 2 - 0.03, 0);
  sill.castShadow = true; sill.receiveShadow = true;
  group.add(sill);

  group.userData.originalPosition = group.position.clone();
  group.userData.originalRotationY = group.rotation.y;
}

function buildDoor(group, w, h, wallT, frameDepth, opening) {
  const isGarage = opening.type === 'garage-door' || w >= 2.2;
  const isSliding = opening.type === 'sliding-door';
  const frameMat = frameMaterial('wood', opening.color);
  const slabMat = doorMaterial(isGarage ? 'garage' : 'wood', opening.color);

  // Frame (jambs + head, no sill — doors sit on the finished floor)
  const frameThk = 0.06;
  const jamb = (x) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(frameThk, h + frameThk, frameDepth * 1.05), frameMat);
    m.position.set(x, frameThk / 2, 0);
    return m;
  };
  group.add(jamb(-w / 2 + frameThk / 2));
  group.add(jamb(w / 2 - frameThk / 2));
  const head = new THREE.Mesh(new THREE.BoxGeometry(w, frameThk, frameDepth * 1.05), frameMat);
  head.position.set(0, h / 2 + frameThk / 2, 0);
  group.add(head);

  if (isGarage) {
    // Sectional garage door — horizontal panel lines instead of a flat slab.
    const doorGroup = new THREE.Group();
    const sections = 4;
    for (let i = 0; i < sections; i++) {
      const secH = h / sections;
      const panel = new THREE.Mesh(new THREE.BoxGeometry(w - 0.06, secH - 0.02, 0.05), slabMat);
      panel.position.set(0, -h / 2 + secH * (i + 0.5), frameDepth * 0.3);
      panel.castShadow = true;
      doorGroup.add(panel);
    }
    group.add(doorGroup);
  } else if (isSliding) {
    const panelW = w / 2;
    for (let i = 0; i < 2; i++) {
      const glass = new THREE.Mesh(new THREE.BoxGeometry(panelW - 0.04, h - 0.04, 0.03), glazingMaterial());
      glass.position.set(-w / 2 + panelW * (i + 0.5), 0, i === 0 ? 0.02 : -0.02);
      group.add(glass);
      const trackFrame = new THREE.Mesh(new THREE.BoxGeometry(panelW, 0.05, 0.04), frameMat);
      trackFrame.position.set(-w / 2 + panelW * (i + 0.5), -h / 2 + 0.025, i === 0 ? 0.02 : -0.02);
      group.add(trackFrame);
    }
  } else {
    // Hinged door slab, offset to whichever jamb it swings from, with a
    // recessed panel look and a handle.
    const hingeSign = opening.swing === 'left' ? -1 : 1;
    const slab = new THREE.Mesh(new THREE.BoxGeometry(w * 0.94, h * 0.98, 0.045), slabMat);
    slab.position.set(-hingeSign * (w * 0.03), 0, 0);
    slab.castShadow = true; slab.receiveShadow = true;
    group.add(slab);

    const panelInset = new THREE.Mesh(new THREE.BoxGeometry(w * 0.6, h * 0.35, 0.01), slabMat);
    panelInset.position.set(-hingeSign * (w * 0.03), h * 0.15, 0.025);
    group.add(panelInset);

    const handle = new THREE.Mesh(new THREE.SphereGeometry(0.02, 8, 8), frameMaterial('aluminium'));
    handle.position.set(hingeSign * (w * 0.38), 0, 0.03);
    group.add(handle);

    // Threshold
    const threshold = new THREE.Mesh(new THREE.BoxGeometry(w, 0.03, wallT + 0.06), frameMaterial('stone', '#c9c4b6'));
    threshold.position.set(0, -h / 2 - 0.015, 0);
    group.add(threshold);
  }

  group.userData.originalPosition = group.position.clone();
  group.userData.originalRotationY = group.rotation.y;
}
