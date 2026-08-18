import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { logoFor } from '@/config/company-logos';

const company = (displayName: string, companyCode = 'X') => ({
  displayName,
  legalName: displayName,
  companyCode,
});

describe('company logos', () => {
  it('gives every Marina company the same mark', () => {
    // The rule the business gave is about the start of the name, so a Marina
    // company that does not exist yet has to be covered by it too.
    const marks = [
      'บริษัท มาริน่า โกลเด้น เบย์ วิคทอเรีย จำกัด',
      'บริษัท มาริน่า โกลเด้น เบย์ เอลย่า จำกัด',
      'บริษัท มาริน่า โกลเด้น เบย์ เจนิวา จำกัด',
      'บริษัท มาริน่า โกลเด้น เบย์ อะไรก็ตามในอนาคต จำกัด',
    ].map((name) => logoFor(company(name)));

    assert.equal(new Set(marks).size, 1);
    assert.equal(marks[0], '/logos/marina-golden-bay.png');
  });

  it('matches the other companies by name', () => {
    assert.equal(
      logoFor(company('บริษัท เดอะ ซัน ไลท์ เรสซิเด้นซ์ 9 จำกัด')),
      '/logos/harmonia.png',
    );
    assert.equal(logoFor(company('บริษัท ไชยธนินทร์ จำกัด')), '/logos/chaithanin.png');
    assert.equal(logoFor(company('บริษัท โกลบอล ท็อป กรุ๊ป จำกัด')), '/logos/global-top-group.png');
  });

  it('falls back to the code when the name is not Thai', () => {
    assert.equal(logoFor(company('Marina Golden Bay Co', 'MARINA_VTR')), '/logos/marina-golden-bay.png');
  });

  it('returns nothing for a company no rule covers', () => {
    // Better than a default mark: a company showing another company's logo is
    // worse than one showing its initials.
    assert.equal(logoFor(company('Some New Holding Co', 'NEWCO')), null);
  });
});
