export class WelfareService {
  private welfareServices = [
    { id: 'wel-001', title: '노인맞춤돌봄서비스', category: '생활 지원', description: '안전 확인, 생활 교육, 외출 동행 등 필요한 돌봄을 지원합니다.', agency: '읍·면·동 행정복지센터' },
    { id: 'wel-002', title: '긴급복지 생계지원', category: '생계 지원', description: '위기 상황으로 생계 유지가 어려운 경우 지원을 상담할 수 있습니다.', agency: '보건복지상담센터 129' },
    { id: 'wel-003', title: '주거급여', category: '주거 지원', description: '가구의 소득과 주거 상황에 따라 주거비 지원을 확인할 수 있습니다.', agency: '복지로 · 행정복지센터' },
    { id: 'wel-004', title: '응급안전안심서비스', category: '안전 지원', description: '안전 확인이 필요한 대상자의 응급 상황 대응을 지원합니다.', agency: '관할 행정복지센터' },
  ];

  async getWelfareServices() {
    return this.welfareServices;
  }
}

export const welfareService = new WelfareService();