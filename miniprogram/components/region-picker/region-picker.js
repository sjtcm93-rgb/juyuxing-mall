// 省市区三级联动组件（基础版，调用云函数 / 内置数据兜底）
const API = require('../../utils/api');

Component({
  properties: {
    value: { type: Array, value: [] }, // ['省','市','区']
    disabled: { type: Boolean, value: false }
  },
  data: {
    visible: false,
    tabs: [],
    activeTab: 0,
    provinces: [],
    cities: [],
    districts: [],
    selected: [],
    loading: false
  },

  lifetimes: {
    attached() {
      // 优先调云函数拉取数据，失败用兜底
      this.loadProvinces();
    }
  },

  methods: {
    async loadProvinces() {
      this.setData({ loading: true });
      // 没有专门的 region 云函数，优先用云数据库的 regions 集合（兼容兜底）
      let provinces = [];
      try {
        if (wx.cloud && getApp().globalData.cloudReady) {
          const db = wx.cloud.database();
          const res = await db.collection('regions').where({ level: 1 }).limit(100).get();
          if (res.data && res.data.length > 0) {
            provinces = res.data.map(r => ({ name: r.name, code: r.code || r.name }));
          }
        }
      } catch (e) {}
      if (provinces.length === 0) {
        provinces = FALLBACK_PROVINCES.map(n => ({ name: n, code: n }));
      }
      this.setData({ provinces, loading: false });
    },

    async onPickProvince(e) {
      const idx = e.currentTarget.dataset.idx;
      const province = this.data.provinces[idx];
      if (!province) return;
      const selected = [province.name];
      this.setData({ selected, activeTab: 1, cities: [] });
      await this.loadCities(province);
    },

    async loadCities(province) {
      this.setData({ loading: true });
      let cities = [];
      try {
        if (wx.cloud && getApp().globalData.cloudReady) {
          const db = wx.cloud.database();
          const res = await db.collection('regions').where({ level: 2, parent: province.name }).limit(200).get();
          if (res.data && res.data.length > 0) cities = res.data.map(r => ({ name: r.name, code: r.code || r.name }));
        }
      } catch (e) {}
      if (cities.length === 0) {
        cities = (FALLBACK_CITIES[province.name] || ['北京市', '上海市', '广州市']).map(n => ({ name: n, code: n }));
      }
      this.setData({ cities, loading: false });
    },

    async onPickCity(e) {
      const idx = e.currentTarget.dataset.idx;
      const city = this.data.cities[idx];
      if (!city) return;
      const selected = [this.data.selected[0], city.name];
      this.setData({ selected, activeTab: 2, districts: [] });
      await this.loadDistricts(this.data.selected[0], city);
    },

    async loadDistricts(province, city) {
      this.setData({ loading: true });
      let districts = [];
      try {
        if (wx.cloud && getApp().globalData.cloudReady) {
          const db = wx.cloud.database();
          const res = await db.collection('regions').where({ level: 3, parent: city.name }).limit(300).get();
          if (res.data && res.data.length > 0) districts = res.data.map(r => ({ name: r.name, code: r.code || r.name }));
        }
      } catch (e) {}
      if (districts.length === 0) {
        districts = (FALLBACK_DISTRICTS[city.name] || ['东城区', '西城区', '朝阳区', '海淀区']).map(n => ({ name: n, code: n }));
      }
      this.setData({ districts, loading: false });
    },

    onPickDistrict(e) {
      const idx = e.currentTarget.dataset.idx;
      const district = this.data.districts[idx];
      if (!district) return;
      const selected = [this.data.selected[0], this.data.selected[1], district.name];
      this.setData({ selected });
      this.triggerEvent('change', { value: selected });
      this.hide();
    },

    onSwitchTab(e) {
      const tab = Number(e.currentTarget.dataset.tab);
      this.setData({ activeTab: tab });
    },

    onTapSelected(e) {
      const idx = Number(e.currentTarget.dataset.idx);
      this.setData({ activeTab: idx });
    },

    show() { if (!this.data.disabled) this.setData({ visible: true }); },
    hide() { this.setData({ visible: false }); },
    onCancel() { this.hide(); },
    onConfirm() {
      const v = this.data.selected || [];
      if (v.length === 3) {
        this.triggerEvent('change', { value: v });
        this.hide();
      }
    }
  }
});

// 兜底数据：常见省份 + 直辖市
const FALLBACK_PROVINCES = ['北京市', '上海市', '广东省', '江苏省', '浙江省', '四川省', '湖北省', '陕西省', '云南省'];
const FALLBACK_CITIES = {
  '北京市': ['北京市'],
  '上海市': ['上海市'],
  '广东省': ['广州市', '深圳市', '东莞市', '佛山市'],
  '江苏省': ['南京市', '苏州市', '无锡市'],
  '浙江省': ['杭州市', '宁波市', '温州市'],
  '四川省': ['成都市', '绵阳市'],
  '湖北省': ['武汉市', '宜昌市'],
  '陕西省': ['西安市', '咸阳市'],
  '云南省': ['昆明市', '大理市']
};
const FALLBACK_DISTRICTS = {
  '北京市': ['东城区', '西城区', '朝阳区', '海淀区', '丰台区'],
  '上海市': ['黄浦区', '徐汇区', '长宁区', '静安区', '浦东新区'],
  '广州市': ['天河区', '越秀区', '海珠区', '白云区'],
  '深圳市': ['福田区', '罗湖区', '南山区', '宝安区'],
  '南京市': ['鼓楼区', '玄武区', '建邺区', '秦淮区'],
  '杭州市': ['西湖区', '上城区', '下城区', '滨江区'],
  '成都市': ['锦江区', '青羊区', '金牛区', '武侯区'],
  '武汉市': ['江汉区', '武昌区', '洪山区'],
  '西安市': ['碑林区', '雁塔区', '莲湖区']
};
