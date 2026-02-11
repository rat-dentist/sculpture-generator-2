function rotateXY(point, yawRadians) {
  const cos = Math.cos(yawRadians);
  const sin = Math.sin(yawRadians);
  return {
    x: point.x * cos - point.y * sin,
    y: point.x * sin + point.y * cos,
    z: point.z
  };
}

export function projectPoint(point, view) {
  const yaw = (view.yawDeg * Math.PI) / 180;
  const rotated = rotateXY(point, yaw);
  const x = (rotated.x - rotated.y) * view.scale;
  const y = (rotated.x + rotated.y) * 0.5 * view.scale - rotated.z * view.scale;
  const depth = rotated.x + rotated.y + rotated.z;

  return { x, y, depth };
}

function classifyFace(normal, yaw) {
  const rotatedNormal = rotateXY(normal, yaw);
  const facing = rotatedNormal.x + rotatedNormal.y + rotatedNormal.z;

  if (facing <= 0) {
    return { visible: false, faceType: "none" };
  }

  if (rotatedNormal.z > 0.55) {
    return { visible: true, faceType: "top" };
  }

  const isoX = rotatedNormal.x - rotatedNormal.y;
  return { visible: true, faceType: isoX >= 0 ? "right" : "left" };
}

export function projectFaces(faces, view) {
  const yaw = (view.yawDeg * Math.PI) / 180;
  const visibleFaces = [];

  for (const face of faces) {
    const classification = classifyFace(face.normal, yaw);
    if (!classification.visible) {
      continue;
    }

    const points = face.corners.map((corner) => projectPoint(corner, view));
    const depth = points.reduce((sum, point) => sum + point.depth, 0) / points.length;

    visibleFaces.push({
      id: face.id,
      faceType: classification.faceType,
      area: face.area,
      points: points.map((point) => ({ x: point.x, y: point.y })),
      depth
    });
  }

  visibleFaces.sort((a, b) => a.depth - b.depth);
  return visibleFaces;
}