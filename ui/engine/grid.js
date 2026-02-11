export class VoxelGrid {
  constructor(width, depth, height) {
    this.width = width;
    this.depth = depth;
    this.height = height;
    this.data = new Uint8Array(width * depth * height);
  }

  index(x, y, z) {
    return z * this.width * this.depth + y * this.width + x;
  }

  inBounds(x, y, z) {
    return x >= 0 && y >= 0 && z >= 0 && x < this.width && y < this.depth && z < this.height;
  }

  get(x, y, z) {
    if (!this.inBounds(x, y, z)) {
      return 0;
    }
    return this.data[this.index(x, y, z)];
  }

  set(x, y, z, value) {
    if (!this.inBounds(x, y, z)) {
      return;
    }
    this.data[this.index(x, y, z)] = value ? 1 : 0;
  }

  fillCuboid(x, y, z, w, d, h, value = true) {
    const x0 = Math.max(0, x);
    const y0 = Math.max(0, y);
    const z0 = Math.max(0, z);
    const x1 = Math.min(this.width, x + w);
    const y1 = Math.min(this.depth, y + d);
    const z1 = Math.min(this.height, z + h);

    for (let zz = z0; zz < z1; zz += 1) {
      for (let yy = y0; yy < y1; yy += 1) {
        for (let xx = x0; xx < x1; xx += 1) {
          this.set(xx, yy, zz, value);
        }
      }
    }
  }

  highestAt(x, y) {
    for (let z = this.height - 1; z >= 0; z -= 1) {
      if (this.get(x, y, z)) {
        return z;
      }
    }
    return -1;
  }

  countOccupied() {
    let count = 0;
    for (let i = 0; i < this.data.length; i += 1) {
      if (this.data[i]) {
        count += 1;
      }
    }
    return count;
  }

  forEachOccupied(callback) {
    for (let z = 0; z < this.height; z += 1) {
      for (let y = 0; y < this.depth; y += 1) {
        for (let x = 0; x < this.width; x += 1) {
          if (this.get(x, y, z)) {
            callback(x, y, z);
          }
        }
      }
    }
  }
}