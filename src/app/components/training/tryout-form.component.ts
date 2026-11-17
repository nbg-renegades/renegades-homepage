import { ChangeDetectionStrategy, Component, signal, inject } from "@angular/core";
import {
  FormBuilder,
  FormGroup,
  ReactiveFormsModule,
  Validators,
} from "@angular/forms";
import { TranslatePipe } from "../../pipes/translate.pipe";
import { TryoutService } from "../../services/tryout.service";
import { RecaptchaService } from "../../services/recaptcha.service";

@Component({
  selector: "app-tryout-form",
  standalone: true,
  imports: [ReactiveFormsModule, TranslatePipe],
  templateUrl: "./tryout-form.component.html",
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class TryoutFormComponent {
  private fb = inject(FormBuilder);
  private tryoutService = inject(TryoutService);
  protected recaptchaService = inject(RecaptchaService);

  tryoutForm: FormGroup;
  isSubmitting = signal(false);
  submitSuccess = signal(false);
  submitError = signal(false);

  constructor() {
    this.tryoutForm = this.fb.group({
      name: ["", Validators.required],
      email: ["", [Validators.required, Validators.email]],
      phone: [""],
      age: [""],
      experience: [""],
      message: [""],
    });
  }

  async onSubmit() {
    if (this.tryoutForm.valid) {
      this.isSubmitting.set(true);
      this.submitSuccess.set(false);
      this.submitError.set(false);

      try {
        const recaptchaToken = await this.recaptchaService.executeRecaptcha('tryout_form');
        await this.tryoutService.submitTryoutForm({
          ...this.tryoutForm.value,
          recaptchaToken
        });
        this.submitSuccess.set(true);
        this.tryoutForm.reset();
      } catch (error) {
        console.error("Error submitting form:", error);
        this.submitError.set(true);
      } finally {
        this.isSubmitting.set(false);
      }
    }
  }
}