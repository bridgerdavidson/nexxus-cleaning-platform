import React from 'react';
import { Sparkles, Leaf, ShieldCheck, Star, Calendar, Clock, CheckCircle, Home, UserCheck, Settings } from 'lucide-react';

export default function ServicesPage() {
  return (
    <div className="min-h-screen bg-gray-50">
      {/* Hero Section */}
      <section className="bg-gradient-to-br from-slate-900 to-slate-700 text-white py-24 relative overflow-hidden">
        <div className="absolute inset-0 bg-black/20"></div>
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 relative z-10">
          <div className="text-center">
            <div className="inline-block px-4 py-2 bg-white/10 backdrop-blur-sm rounded-full text-sm font-medium mb-6">
              ✨ Professional Cleaning Services
            </div>
            <h1 className="text-5xl lg:text-6xl font-black mb-8 leading-tight">
              Expertise That Drives<br />
              <span className="text-primary-400">Quality</span>
            </h1>
            <p className="text-xl text-gray-300 mb-10 leading-relaxed max-w-3xl mx-auto">
              We're committed to providing the best cleaning experience with professional standards
            </p>
          </div>
        </div>
      </section>

      {/* Main Services */}
      <section className="py-24 bg-white">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-20">
            <h2 className="text-4xl lg:text-5xl font-black text-slate-900 mb-6">
              Our Core Services
            </h2>
            <p className="text-xl text-gray-600 max-w-3xl mx-auto">
              Professional cleaning solutions tailored to your needs
            </p>
          </div>
          
          <div className="grid grid-cols-1 md:grid-cols-3 gap-12">
            <div className="bg-white rounded-2xl shadow-lg border border-gray-100 p-8 transition-all duration-300 hover:shadow-xl text-center group">
              <div className="w-16 h-16 bg-green-100 rounded-2xl flex items-center justify-center mx-auto mb-8">
                <Leaf className="w-8 h-8 text-green-600" />
              </div>
              <h3 className="text-2xl font-bold text-slate-900 mb-6">Eco-Friendly Products</h3>
              <p className="text-gray-600 text-lg leading-relaxed">
                Safe for your family and pets. We use only environmentally responsible cleaning products.
              </p>
            </div>
            
            <div className="bg-white rounded-2xl shadow-lg border border-gray-100 p-8 transition-all duration-300 hover:shadow-xl text-center group">
              <div className="w-16 h-16 bg-primary-100 rounded-2xl flex items-center justify-center mx-auto mb-8">
                <ShieldCheck className="w-8 h-8 text-primary-600" />
              </div>
              <h3 className="text-2xl font-bold text-slate-900 mb-6">Trusted Professionals</h3>
              <p className="text-gray-600 text-lg leading-relaxed">
                All cleaners are background-checked, insured, and highly rated by customers.
              </p>
            </div>
            
            <div className="bg-white rounded-2xl shadow-lg border border-gray-100 p-8 transition-all duration-300 hover:shadow-xl text-center group">
              <div className="w-16 h-16 bg-yellow-100 rounded-2xl flex items-center justify-center mx-auto mb-8">
                <Star className="w-8 h-8 text-yellow-600" />
              </div>
              <h3 className="text-2xl font-bold text-slate-900 mb-6">Satisfaction Guarantee</h3>
              <p className="text-gray-600 text-lg leading-relaxed">
                Not happy? We'll make it right or your money back. Your satisfaction is our priority.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* How It Works */}
      <section className="py-24 bg-gray-50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-20">
            <h2 className="text-4xl lg:text-5xl font-black text-slate-900 mb-6">
              Experience the Benefits<br />
              of Our Expertise
            </h2>
            <p className="text-xl text-gray-600 max-w-3xl mx-auto">
              Getting your home cleaned is as easy as 1-2-3
            </p>
          </div>
          
          <div className="grid grid-cols-1 md:grid-cols-3 gap-12">
            <div className="bg-white rounded-2xl shadow-lg border border-gray-100 p-8 transition-all duration-300 hover:shadow-xl text-center group">
              <div className="w-20 h-20 bg-slate-900 rounded-2xl flex items-center justify-center mx-auto mb-8 group-hover:scale-110 transition-transform duration-300">
                <Calendar className="w-10 h-10 text-white" />
              </div>
              <h3 className="text-2xl font-bold text-slate-900 mb-6">1. Request Quote</h3>
              <p className="text-gray-600 text-lg leading-relaxed">
                Tell us about your home and cleaning needs. Get an instant, transparent quote.
              </p>
            </div>
            
            <div className="bg-white rounded-2xl shadow-lg border border-gray-100 p-8 transition-all duration-300 hover:shadow-xl text-center group">
              <div className="w-20 h-20 bg-slate-900 rounded-2xl flex items-center justify-center mx-auto mb-8 group-hover:scale-110 transition-transform duration-300">
                <Clock className="w-10 h-10 text-white" />
              </div>
              <h3 className="text-2xl font-bold text-slate-900 mb-6">2. Schedule Cleaning</h3>
              <p className="text-gray-600 text-lg leading-relaxed">
                Choose your preferred date and time. We'll match you with a trusted, vetted cleaner.
              </p>
            </div>
            
            <div className="bg-white rounded-2xl shadow-lg border border-gray-100 p-8 transition-all duration-300 hover:shadow-xl text-center group">
              <div className="w-20 h-20 bg-slate-900 rounded-2xl flex items-center justify-center mx-auto mb-8 group-hover:scale-110 transition-transform duration-300">
                <CheckCircle className="w-10 h-10 text-white" />
              </div>
              <h3 className="text-2xl font-bold text-slate-900 mb-6">3. Sit Back & Relax</h3>
              <p className="text-gray-600 text-lg leading-relaxed">
                Your cleaner arrives on time and transforms your home. Satisfaction guaranteed.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Service Types */}
      <section className="py-24 bg-white">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-20">
            <h2 className="text-4xl lg:text-5xl font-black text-slate-900 mb-6">
              Service Types
            </h2>
            <p className="text-xl text-gray-600 max-w-3xl mx-auto">
              Choose the cleaning service that fits your needs
            </p>
          </div>
          
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
            {/* Regular Cleaning */}
            <div className="bg-white rounded-2xl shadow-lg border border-gray-100 p-8 transition-all duration-300 hover:shadow-xl">
              <div className="w-16 h-16 bg-primary-100 rounded-2xl flex items-center justify-center mb-6">
                <Home className="w-8 h-8 text-primary-600" />
              </div>
              <h3 className="text-2xl font-bold text-slate-900 mb-4">Regular Cleaning</h3>
              <p className="text-gray-600 mb-6">
                Weekly, bi-weekly, or monthly cleaning to maintain your home's cleanliness.
              </p>
              <ul className="text-gray-600 space-y-2 mb-6">
                <li className="flex items-center">
                  <CheckCircle className="w-5 h-5 text-green-500 mr-2" />
                  Dusting and vacuuming
                </li>
                <li className="flex items-center">
                  <CheckCircle className="w-5 h-5 text-green-500 mr-2" />
                  Kitchen and bathroom cleaning
                </li>
                <li className="flex items-center">
                  <CheckCircle className="w-5 h-5 text-green-500 mr-2" />
                  Floor mopping
                </li>
                <li className="flex items-center">
                  <CheckCircle className="w-5 h-5 text-green-500 mr-2" />
                  Trash removal
                </li>
              </ul>
              <div className="text-3xl font-bold text-slate-900 mb-4">Starting at $80</div>
            </div>

            {/* Deep Cleaning */}
            <div className="bg-white rounded-2xl shadow-lg border border-gray-100 p-8 transition-all duration-300 hover:shadow-xl">
              <div className="w-16 h-16 bg-purple-100 rounded-2xl flex items-center justify-center mb-6">
                <Sparkles className="w-8 h-8 text-purple-600" />
              </div>
              <h3 className="text-2xl font-bold text-slate-900 mb-4">Deep Cleaning</h3>
              <p className="text-gray-600 mb-6">
                Comprehensive cleaning for move-ins, special occasions, or seasonal cleaning.
              </p>
              <ul className="text-gray-600 space-y-2 mb-6">
                <li className="flex items-center">
                  <CheckCircle className="w-5 h-5 text-green-500 mr-2" />
                  Everything in regular cleaning
                </li>
                <li className="flex items-center">
                  <CheckCircle className="w-5 h-5 text-green-500 mr-2" />
                  Inside appliances
                </li>
                <li className="flex items-center">
                  <CheckCircle className="w-5 h-5 text-green-500 mr-2" />
                  Baseboards and window sills
                </li>
                <li className="flex items-center">
                  <CheckCircle className="w-5 h-5 text-green-500 mr-2" />
                  Light fixtures and ceiling fans
                </li>
              </ul>
              <div className="text-3xl font-bold text-slate-900 mb-4">Starting at $150</div>
            </div>

            {/* Move-out Cleaning */}
            <div className="bg-white rounded-2xl shadow-lg border border-gray-100 p-8 transition-all duration-300 hover:shadow-xl">
              <div className="w-16 h-16 bg-green-100 rounded-2xl flex items-center justify-center mb-6">
                <UserCheck className="w-8 h-8 text-green-600" />
              </div>
              <h3 className="text-2xl font-bold text-slate-900 mb-4">Move-out Cleaning</h3>
              <p className="text-gray-600 mb-6">
                Thorough cleaning to help you get your security deposit back.
              </p>
              <ul className="text-gray-600 space-y-2 mb-6">
                <li className="flex items-center">
                  <CheckCircle className="w-5 h-5 text-green-500 mr-2" />
                  Everything in deep cleaning
                </li>
                <li className="flex items-center">
                  <CheckCircle className="w-5 h-5 text-green-500 mr-2" />
                  Inside cabinets and drawers
                </li>
                <li className="flex items-center">
                  <CheckCircle className="w-5 h-5 text-green-500 mr-2" />
                  Carpet cleaning
                </li>
                <li className="flex items-center">
                  <CheckCircle className="w-5 h-5 text-green-500 mr-2" />
                  Wall washing
                </li>
              </ul>
              <div className="text-3xl font-bold text-slate-900 mb-4">Starting at $200</div>
            </div>
          </div>
        </div>
      </section>

      {/* CTA Section */}
      <section className="py-24 bg-slate-900 text-white">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
          <h2 className="text-4xl lg:text-5xl font-black mb-8">
            Ready to Get Started?
          </h2>
          <p className="text-xl text-gray-300 mb-10 max-w-3xl mx-auto">
            Book your cleaning service today and experience the Nexxus difference
          </p>
          <div className="flex flex-col sm:flex-row gap-6 justify-center">
            <button className="bg-white text-slate-900 hover:bg-gray-100 font-bold py-4 px-10 rounded-lg transition-all duration-300 transform hover:scale-105 text-lg">
              Get A Quote Today
            </button>
            <button className="border-2 border-white text-white hover:bg-white hover:text-slate-900 font-bold py-4 px-10 rounded-lg transition-all duration-300 text-lg">
              Learn More
            </button>
          </div>
        </div>
      </section>
    </div>
  );
}
