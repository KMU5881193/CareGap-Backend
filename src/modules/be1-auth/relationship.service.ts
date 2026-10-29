// src/modules/be1-auth/relationship.service.ts

export interface PatientRelation {
  patientIdentifier: string;
  linkedIdentifier: string; // Family 또는 Staff의 identifier
  relationType: 'FAMILY' | 'STAFF';
}

export class RelationshipService {
  // 메모리 기반 관계 스토리지
  private relations: PatientRelation[] = [];

  // 환자와 보호자/담당자 연결 생성
  async linkUser(patientIdentifier: string, linkedIdentifier: string, relationType: 'FAMILY' | 'STAFF') {
    // 중복 연결 방지 체크
    const exists = this.relations.some(
      (r) => r.patientIdentifier === patientIdentifier && r.linkedIdentifier === linkedIdentifier
    );
    if (exists) {
      throw new Error('RELATION_ALREADY_EXISTS');
    }

    const newRelation: PatientRelation = {
      patientIdentifier,
      linkedIdentifier,
      relationType,
    };

    this.relations.push(newRelation);

    return {
      success: true,
      data: newRelation,
      message: `${relationType} successfully linked to patient.`,
    };
  }

  // 특정 환자에 연결된 보호자/담당자 목록 조회
  async getRelationsByPatient(patientIdentifier: string) {
    return this.relations.filter((r) => r.patientIdentifier === patientIdentifier);
  }
}

export const relationshipService = new RelationshipService();