import React from 'react';
import { MapPin, Phone, Mail, Clock, MessageCircle, Send, CheckCircle, Star } from 'lucide-react';

export default function ContactPage() {
  return (
    <div className="min-h-screen bg-gray-50">
      {/* Hero Section */}
      <section className="bg-gradient-to-br from-slate-900 to-slate-700 text-white py-24 relative overflow-hidden">
        <div className="absolute inset-0 bg-black/20"></div>
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 relative z-10">
          <div className="text-center">
            <div className="inline-block px-4 py-2 bg-white/10 backdrop-blur-sm rounded-full text-sm font-medium mb-6">
              ✨ Get In Touch
            </div>
            <h1 className="text-5xl lg:text-6xl font-black mb-8 leading-tight">
              Ready to Get<br />
              <span className="text-primary-400">Started?</span>
            </h1>
            <p className="text-xl text-gray-300 mb-10 leading-relaxed max-w-3xl mx-auto">
              Contact us today for a free quote or to schedule your cleaning service. 
              We're here to answer all your questions and make your home sparkle.
            </p>
          </div>
        </div>
      </section>

      {/* Contact Form & Info */}
      <section className="py-24 bg-white">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-16">
            {/* Contact Form */}
            <div>
              <h2 className="text-4xl font-black text-slate-900 mb-8">
                Get Your Free Quote
              </h2>
              <p className="text-xl text-gray-600 mb-10">
                Fill out the form below and we'll get back to you within 24 hours with a personalized quote.
              </p>
              
              <form className="space-y-6">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div>
                    <label className="block text-sm font-bold text-slate-900 mb-3">First Name</label>
                    <input 
                      type="text" 
                      className="w-full px-4 py-4 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500 transition-all duration-200 bg-white"
                      placeholder="Enter your first name"
                      required
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-bold text-slate-900 mb-3">Last Name</label>
                    <input 
                      type="text" 
                      className="w-full px-4 py-4 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500 transition-all duration-200 bg-white"
                      placeholder="Enter your last name"
                      required
                    />
                  </div>
                </div>
                
                <div>
                  <label className="block text-sm font-bold text-slate-900 mb-3">Email Address</label>
                  <input 
                    type="email" 
                    className="w-full px-4 py-4 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500 transition-all duration-200 bg-white"
                    placeholder="Enter your email address"
                    required
                  />
                </div>
                
                <div>
                  <label className="block text-sm font-bold text-slate-900 mb-3">Phone Number</label>
                  <input 
                    type="tel" 
                    className="w-full px-4 py-4 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500 transition-all duration-200 bg-white"
                    placeholder="Enter your phone number"
                    required
                  />
                </div>
                
                <div>
                  <label className="block text-sm font-bold text-slate-900 mb-3">Service Type</label>
                  <select className="w-full px-4 py-4 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500 transition-all duration-200 bg-white">
                    <option value="">Select a service</option>
                    <option value="regular">Regular Cleaning</option>
                    <option value="deep">Deep Cleaning</option>
                    <option value="moveout">Move-out Cleaning</option>
                    <option value="custom">Custom Service</option>
                  </select>
                </div>
                
                <div>
                  <label className="block text-sm font-bold text-slate-900 mb-3">Home Address</label>
                  <input 
                    type="text" 
                    className="w-full px-4 py-4 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500 transition-all duration-200 bg-white"
                    placeholder="Enter your home address"
                    required
                  />
                </div>
                
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div>
                    <label className="block text-sm font-bold text-slate-900 mb-3">Bedrooms</label>
                    <select className="w-full px-4 py-4 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500 transition-all duration-200 bg-white">
                      <option value="">Select</option>
                      <option value="1">1 Bedroom</option>
                      <option value="2">2 Bedrooms</option>
                      <option value="3">3 Bedrooms</option>
                      <option value="4">4 Bedrooms</option>
                      <option value="5+">5+ Bedrooms</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-sm font-bold text-slate-900 mb-3">Bathrooms</label>
                    <select className="w-full px-4 py-4 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500 transition-all duration-200 bg-white">
                      <option value="">Select</option>
                      <option value="1">1 Bathroom</option>
                      <option value="2">2 Bathrooms</option>
                      <option value="3">3 Bathrooms</option>
                      <option value="4">4 Bathrooms</option>
                      <option value="5+">5+ Bathrooms</option>
                    </select>
                  </div>
                </div>
                
                <div>
                  <label className="block text-sm font-bold text-slate-900 mb-3">Additional Details</label>
                  <textarea 
                    rows={4}
                    className="w-full px-4 py-4 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500 transition-all duration-200 bg-white"
                    placeholder="Tell us about any specific cleaning needs, preferences, or questions you have..."
                  ></textarea>
                </div>
                
                <button 
                  type="submit" 
                  className="w-full bg-slate-900 text-white hover:bg-slate-800 font-bold py-4 px-8 rounded-lg transition-all duration-300 transform hover:scale-105 text-lg flex items-center justify-center"
                >
                  <Send className="w-6 h-6 mr-3" />
                  Get My Free Quote
                </button>
              </form>
            </div>
            
            {/* Contact Information */}
            <div>
              <h2 className="text-4xl font-black text-slate-900 mb-8">
                Contact Information
              </h2>
              
              <div className="space-y-8 mb-12">
                <div className="flex items-start space-x-4">
                  <div className="w-12 h-12 bg-primary-100 rounded-xl flex items-center justify-center flex-shrink-0">
                    <Phone className="w-6 h-6 text-primary-600" />
                  </div>
                  <div>
                    <h3 className="text-xl font-bold text-slate-900 mb-2">Phone</h3>
                    <p className="text-gray-600 text-lg">(602) 555-CLEAN</p>
                    <p className="text-gray-600">(602) 555-2532</p>
                  </div>
                </div>
                
                <div className="flex items-start space-x-4">
                  <div className="w-12 h-12 bg-green-100 rounded-xl flex items-center justify-center flex-shrink-0">
                    <Mail className="w-6 h-6 text-green-600" />
                  </div>
                  <div>
                    <h3 className="text-xl font-bold text-slate-900 mb-2">Email</h3>
                    <p className="text-gray-600 text-lg">hello@nexxuscleaning.com</p>
                    <p className="text-gray-600">quotes@nexxuscleaning.com</p>
                  </div>
                </div>
                
                <div className="flex items-start space-x-4">
                  <div className="w-12 h-12 bg-purple-100 rounded-xl flex items-center justify-center flex-shrink-0">
                    <MapPin className="w-6 h-6 text-purple-600" />
                  </div>
                  <div>
                    <h3 className="text-xl font-bold text-slate-900 mb-2">Service Area</h3>
                    <p className="text-gray-600 text-lg">Phoenix Metropolitan Area</p>
                    <p className="text-gray-600">Phoenix, Scottsdale, Tempe, Mesa, Chandler, Glendale</p>
                  </div>
                </div>
                
                <div className="flex items-start space-x-4">
                  <div className="w-12 h-12 bg-yellow-100 rounded-xl flex items-center justify-center flex-shrink-0">
                    <Clock className="w-6 h-6 text-yellow-600" />
                  </div>
                  <div>
                    <h3 className="text-xl font-bold text-slate-900 mb-2">Business Hours</h3>
                    <div className="text-gray-600">
                      <p>Monday - Friday: 8:00 AM - 6:00 PM</p>
                      <p>Saturday: 9:00 AM - 4:00 PM</p>
                      <p>Sunday: Closed</p>
                    </div>
                  </div>
                </div>
              </div>
              
              {/* Quick Response Promise */}
              <div className="bg-primary-50 rounded-2xl p-8 border border-primary-100">
                <div className="flex items-center mb-4">
                  <CheckCircle className="w-8 h-8 text-primary-600 mr-3" />
                  <h3 className="text-2xl font-bold text-slate-900">Quick Response Guarantee</h3>
                </div>
                <p className="text-gray-600 text-lg leading-relaxed">
                  We respond to all quote requests within 24 hours. For urgent cleaning needs, 
                  call us directly and we'll do our best to accommodate same-day or next-day service.
                </p>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* FAQ Section */}
      <section className="py-24 bg-gray-50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-20">
            <h2 className="text-4xl lg:text-5xl font-black text-slate-900 mb-6">
              Frequently Asked Questions
            </h2>
            <p className="text-xl text-gray-600 max-w-3xl mx-auto">
              Get answers to common questions about our cleaning services
            </p>
          </div>
          
          <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
            <div className="bg-white rounded-2xl shadow-lg border border-gray-100 p-8">
              <h3 className="text-xl font-bold text-slate-900 mb-4">How much do your services cost?</h3>
              <p className="text-gray-600 leading-relaxed">
                Our pricing depends on the size of your home, type of cleaning, and frequency. 
                Regular cleaning starts at $80, deep cleaning at $150, and move-out cleaning at $200. 
                Contact us for a personalized quote.
              </p>
            </div>
            
            <div className="bg-white rounded-2xl shadow-lg border border-gray-100 p-8">
              <h3 className="text-xl font-bold text-slate-900 mb-4">Are your cleaners insured and bonded?</h3>
              <p className="text-gray-600 leading-relaxed">
                Yes, all our cleaners are fully insured and bonded. We also conduct thorough 
                background checks and provide ongoing training to ensure the highest standards of service.
              </p>
            </div>
            
            <div className="bg-white rounded-2xl shadow-lg border border-gray-100 p-8">
              <h3 className="text-xl font-bold text-slate-900 mb-4">What cleaning products do you use?</h3>
              <p className="text-gray-600 leading-relaxed">
                We use eco-friendly, non-toxic cleaning products that are safe for your family and pets. 
                If you have specific product preferences or allergies, we're happy to accommodate your needs.
              </p>
            </div>
            
            <div className="bg-white rounded-2xl shadow-lg border border-gray-100 p-8">
              <h3 className="text-xl font-bold text-slate-900 mb-4">How far in advance should I book?</h3>
              <p className="text-gray-600 leading-relaxed">
                We recommend booking at least 48 hours in advance for regular cleaning. For deep cleaning 
                or move-out services, we suggest booking 3-5 days ahead. However, we often accommodate same-day requests.
              </p>
            </div>
            
            <div className="bg-white rounded-2xl shadow-lg border border-gray-100 p-8">
              <h3 className="text-xl font-bold text-slate-900 mb-4">What if I'm not satisfied with the cleaning?</h3>
              <p className="text-gray-600 leading-relaxed">
                We offer a 100% satisfaction guarantee. If you're not completely happy with our service, 
                we'll return within 24 hours to make it right at no additional cost.
              </p>
            </div>
            
            <div className="bg-white rounded-2xl shadow-lg border border-gray-100 p-8">
              <h3 className="text-xl font-bold text-slate-900 mb-4">Do I need to be home during the cleaning?</h3>
              <p className="text-gray-600 leading-relaxed">
                No, you don't need to be home. Many of our clients provide us with access instructions 
                and go about their day. We'll send you updates and photos when the cleaning is complete.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Testimonials */}
      <section className="py-24 bg-white">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-20">
            <h2 className="text-4xl lg:text-5xl font-black text-slate-900 mb-6">What Our Customers Say</h2>
            <p className="text-xl text-gray-600">Don't just take our word for it</p>
          </div>
          
          <div className="grid grid-cols-1 md:grid-cols-3 gap-12">
            <div className="bg-white rounded-2xl shadow-lg border border-gray-100 p-8">
              <div className="flex items-center mb-6">
                <div className="flex text-yellow-400">
                  <Star className="w-6 h-6 fill-current" />
                  <Star className="w-6 h-6 fill-current" />
                  <Star className="w-6 h-6 fill-current" />
                  <Star className="w-6 h-6 fill-current" />
                  <Star className="w-6 h-6 fill-current" />
                </div>
              </div>
              <p className="text-gray-600 text-lg mb-8 leading-relaxed">
                "Absolutely amazing service! My house has never been cleaner. The team was professional and thorough."
              </p>
              <div className="flex items-center">
                <div className="w-12 h-12 bg-primary-100 rounded-full flex items-center justify-center mr-4">
                  <span className="text-primary-600 font-bold text-lg">SJ</span>
                </div>
                <div>
                  <p className="font-bold text-slate-900 text-lg">Sarah Johnson</p>
                  <p className="text-gray-500">Phoenix, AZ</p>
                </div>
              </div>
            </div>
            
            <div className="bg-white rounded-2xl shadow-lg border border-gray-100 p-8">
              <div className="flex items-center mb-6">
                <div className="flex text-yellow-400">
                  <Star className="w-6 h-6 fill-current" />
                  <Star className="w-6 h-6 fill-current" />
                  <Star className="w-6 h-6 fill-current" />
                  <Star className="w-6 h-6 fill-current" />
                  <Star className="w-6 h-6 fill-current" />
                </div>
              </div>
              <p className="text-gray-600 text-lg mb-8 leading-relaxed">
                "Reliable, affordable, and eco-friendly. I've been using Nexxus for 6 months and couldn't be happier!"
              </p>
              <div className="flex items-center">
                <div className="w-12 h-12 bg-green-100 rounded-full flex items-center justify-center mr-4">
                  <span className="text-green-600 font-bold text-lg">MW</span>
                </div>
                <div>
                  <p className="font-bold text-slate-900 text-lg">Mike Wilson</p>
                  <p className="text-gray-500">Scottsdale, AZ</p>
                </div>
              </div>
            </div>
            
            <div className="bg-white rounded-2xl shadow-lg border border-gray-100 p-8">
              <div className="flex items-center mb-6">
                <div className="flex text-yellow-400">
                  <Star className="w-6 h-6 fill-current" />
                  <Star className="w-6 h-6 fill-current" />
                  <Star className="w-6 h-6 fill-current" />
                  <Star className="w-6 h-6 fill-current" />
                  <Star className="w-6 h-6 fill-current" />
                </div>
              </div>
              <p className="text-gray-600 text-lg mb-8 leading-relaxed">
                "The booking process was so easy, and the cleaner was fantastic. Will definitely use again!"
              </p>
              <div className="flex items-center">
                <div className="w-12 h-12 bg-purple-100 rounded-full flex items-center justify-center mr-4">
                  <span className="text-purple-600 font-bold text-lg">EB</span>
                </div>
                <div>
                  <p className="font-bold text-slate-900 text-lg">Emily Brown</p>
                  <p className="text-gray-500">Tempe, AZ</p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* CTA Section */}
      <section className="py-24 bg-slate-900 text-white">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
          <h2 className="text-4xl lg:text-5xl font-black mb-8">
            Ready to Book Your Cleaning?
          </h2>
          <p className="text-xl text-gray-300 mb-10 max-w-3xl mx-auto">
            Join over 1,000 satisfied customers who trust Nexxus with their home cleaning needs
          </p>
          <div className="flex flex-col sm:flex-row gap-6 justify-center">
            <button className="bg-white text-slate-900 hover:bg-gray-100 font-bold py-4 px-10 rounded-lg transition-all duration-300 transform hover:scale-105 text-lg">
              Get A Quote Today
            </button>
            <button className="border-2 border-white text-white hover:bg-white hover:text-slate-900 font-bold py-4 px-10 rounded-lg transition-all duration-300 text-lg flex items-center justify-center">
              <Phone className="w-6 h-6 mr-3" />
              Call (602) 555-CLEAN
            </button>
          </div>
        </div>
      </section>
    </div>
  );
}
