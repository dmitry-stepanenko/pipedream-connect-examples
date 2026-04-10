import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ConnectAngular } from './connect-angular';

describe('ConnectAngular', () => {
  let component: ConnectAngular;
  let fixture: ComponentFixture<ConnectAngular>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ConnectAngular],
    }).compileComponents();

    fixture = TestBed.createComponent(ConnectAngular);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
