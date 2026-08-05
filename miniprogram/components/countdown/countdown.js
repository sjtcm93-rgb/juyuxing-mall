Component({
  properties: {
    endTime: { type: null, value: 0 },
    prefix: { type: String, value: '剩余' },
    suffix: { type: String, value: '' }
  },
  data: { d: '00', h: '00', m: '00', s: '00', finished: false },
  lifetimes: {
    attached() { this.tick(); this._timer = setInterval(() => this.tick(), 1000); },
    detached() { if (this._timer) clearInterval(this._timer); }
  },
  methods: {
    parseEnd() {
      var t = this.data.endTime;
      if (!t) return 0;
      if (typeof t === 'number') return t > 1e12 ? t : t * 1000;
      var d = new Date((t + '').replace(/-/g, '/'));
      return isNaN(d.getTime()) ? 0 : d.getTime();
    },
    tick() {
      var end = this.parseEnd();
      if (!end) { this.setData({ finished: true }); return; }
      var diff = Math.max(0, Math.floor((end - Date.now()) / 1000));
      var d = Math.floor(diff / 86400);
      var h = Math.floor((diff % 86400) / 3600);
      var m = Math.floor((diff % 3600) / 60);
      var s = diff % 60;
      var pad = function (n) { return n < 10 ? '0' + n : '' + n; };
      this.setData({ d: pad(d), h: pad(h), m: pad(m), s: pad(s), finished: diff === 0 });
      if (diff === 0 && this._timer) {
        clearInterval(this._timer);
        this._timer = null;
        this.triggerEvent('finish');
      }
    }
  }
});
