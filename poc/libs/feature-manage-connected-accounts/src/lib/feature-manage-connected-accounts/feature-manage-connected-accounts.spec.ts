import { ComponentFixture, TestBed } from '@angular/core/testing';
import { FeatureManageConnectedAccounts } from './feature-manage-connected-accounts';

describe('FeatureManageConnectedAccounts', () => {
  let component: FeatureManageConnectedAccounts;
  let fixture: ComponentFixture<FeatureManageConnectedAccounts>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [FeatureManageConnectedAccounts],
    }).compileComponents();

    fixture = TestBed.createComponent(FeatureManageConnectedAccounts);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
