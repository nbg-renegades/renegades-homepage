import { ChangeDetectionStrategy, Component, computed, signal } from "@angular/core";
import { toSignal } from "@angular/core/rxjs-interop";
import {
  FormBuilder,
  FormGroup,
  ReactiveFormsModule,
  Validators,
} from "@angular/forms";

import { TranslatePipe } from "../../pipes/translate.pipe";
import {
  ADMISSION_FEE,
  MEMBERSHIP_FEES,
  MembershipService,
  MembershipType,
} from "../../services/membership.service";
import { RecaptchaService } from "../../services/recaptcha.service";

@Component({
  selector: "app-membership-form",
  standalone: true,
  imports: [ReactiveFormsModule, TranslatePipe],
  templateUrl: "./membership-form.component.html",
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class MembershipFormComponent {
  membershipForm: FormGroup;
  isSubmitting = signal(false);
  submitSuccess = signal(false);
  submitError = signal(false);
  currentYear = new Date().getFullYear();
  nextYear = this.currentYear + 1;

  readonly membershipTypes = (Object.keys(MEMBERSHIP_FEES) as MembershipType[]).map((value) => ({
    value,
    fee: MEMBERSHIP_FEES[value],
  }));
  readonly admissionFee = String(ADMISSION_FEE);

  readonly #value;
  readonly isYouth = computed(() => this.#value().membership_type === "youth");
  /**
   * The age groups are "ab 16" and "unter 16", counted on the joining date. A mismatch is
   * only pointed out, not blocked: the club decides, and someone turning 16 the month after
   * joining may well be meant for the youth team.
   */
  readonly ageMismatch = computed(() => {
    const { membership_type, birthday, joindate_month, joindate_year } = this.#value();
    if (!birthday || (membership_type !== "adult" && membership_type !== "youth")) return false;
    const [year, month, day] = birthday.split("-").map(Number);
    const join = joindate_month && joindate_year
      ? new Date(Number(joindate_year), Number(joindate_month) - 1, 1)
      : new Date();
    const birthdayReached =
      join.getMonth() + 1 > month || (join.getMonth() + 1 === month && join.getDate() >= day);
    const age = join.getFullYear() - year - (birthdayReached ? 0 : 1);
    return membership_type === "youth" ? age >= 16 : age < 16;
  });

  constructor(
    private fb: FormBuilder, 
    private membershipService: MembershipService,
    protected recaptchaService: RecaptchaService
  ) {
    this.membershipForm = this.fb.group({
      membership_type: ["", Validators.required],
      name: ["", Validators.required],
      firstname: ["", Validators.required],
      birthday: ["", Validators.required],
      birthplace: ["", Validators.required],
      profession: [""],
      nationality: [""],
      street: ["", Validators.required],
      plz_town: ["", Validators.required],
      tel: [""],
      fax: [""],
      mobile: [""],
      email: ["", [Validators.required, Validators.email]],
      joindate_month: ["", Validators.required],
      joindate_year: ["", Validators.required],
      sepa_account_holder_name: [""],
      sepa_account_holder_firstname: [""],
      sepa_iban: [""],
      sepa_bic: [""],
      sepa_bank: [""],
    });
    this.#value = toSignal(this.membershipForm.valueChanges, {
      initialValue: this.membershipForm.value,
    });
  }

  async onSubmit() {
    if (this.membershipForm.valid) {
      this.isSubmitting.set(true);
      this.submitSuccess.set(false);
      this.submitError.set(false);

      try {
        const recaptchaToken = await this.recaptchaService.executeRecaptcha('membership_form');
        await this.membershipService.submitMembershipApplication({
          ...this.membershipForm.value,
          recaptchaToken
        });
        this.submitSuccess.set(true);
        this.membershipForm.reset();
      } catch (error) {
        console.error("Error submitting form:", error);
        this.submitError.set(true);
      } finally {
        this.isSubmitting.set(false);
      }
    }
  }
}