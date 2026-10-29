// 화면 개발용 가상 데이터를 활용한 서비스 뼈대 (추후 Supabase Repository로 교체)
export class ConsultationService {
  private appointments = [
    { id: 'apt-001', personName: '김정희', date: '2026-10-30', time: '10:30', method: '방문 상담', status: '확정', reason: '최근 생활과 건강 상태 확인' },
    { id: 'apt-002', personName: '박영수', date: '2026-10-30', time: '14:00', method: '전화 상담', status: '요청 대기', reason: '복지 서비스 신청 문의' },
    { id: 'apt-003', personName: '최은숙', date: '2026-10-31', time: '11:00', method: '영상 상담', status: '확정', reason: '지난 상담 후속 확인' },
    { id: 'apt-004', personName: '이명자', date: '2026-10-29', time: '09:30', method: '전화 상담', status: '완료', reason: '정기 안부 확인' },
  ];

  private records = [
    { id: 'rec-001', personName: '김정희', date: '2026-10-28', method: '방문 상담', summary: '최근 수면과 일상생활에 대해 이야기함. 식사 상태는 큰 변화가 없다고 함.', aiStatus: '검토 필요' },
    { id: 'rec-002', personName: '김정희', date: '2026-10-14', method: '전화 상담', summary: '식사와 이웃 관계, 일상 활동에 대해 확인함.', aiStatus: '검토 완료' },
    { id: 'rec-003', personName: '최은숙', date: '2026-10-23', method: '영상 상담', summary: '복지 서비스 신청 절차와 다음 상담 일정을 안내함.', aiStatus: '검토 완료' },
  ];

  async getAppointments() {
    return this.appointments;
  }

  async getRecords() {
    return this.records;
  }
}

export const consultationService = new ConsultationService();